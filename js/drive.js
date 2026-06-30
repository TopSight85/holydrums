// drive.js
const CLIENT_ID = '1082622791428-efdjse774bp2erojh33ulj9qua6b6sn2.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';

let tokenClient = null;
let accessToken = null;

export function isDriveConnectedPref() {
    return localStorage.getItem('holydrums_drive_connected') === 'true';
}

export function setDriveConnectedPref(connected) {
    if (connected) {
        localStorage.setItem('holydrums_drive_connected', 'true');
    } else {
        localStorage.removeItem('holydrums_drive_connected');
        accessToken = null;
    }
}

export function initDrive() {
    if (!window.google?.accounts?.oauth2) {
        throw new Error('Google Identity Services não carregou.');
    }

    tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (resp) => {
            if (resp.error) throw new Error(resp.error);
            accessToken = resp.access_token;
        },
    });
}

function getToken(interactive = true) {
    return new Promise((resolve, reject) => {
        if (!tokenClient) return reject(new Error('Drive não inicializado.'));

        tokenClient.callback = (resp) => {
            if (resp.error) {
                setDriveConnectedPref(false);
                return reject(new Error(resp.error));
            }
            accessToken = resp.access_token;
            setDriveConnectedPref(true);
            resolve(accessToken);
        };

        tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
    });
}

async function driveFetch(url, options = {}) {
    if (!accessToken) await getToken(false);

    let res = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(options.headers || {}),
        },
    });

    // Se o token expirou (401), tenta obter um novo silenciosamente e repete
    if (res.status === 401) {
        accessToken = null;
        await getToken(false);
        res = await fetch(url, {
            ...options,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                ...(options.headers || {}),
            },
        });
    }

    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Drive API ${res.status}: ${txt}`);
    }

    return res;
}

async function findBackupFileId() {
    const q = encodeURIComponent("name='holydrums-backup.json' and trashed=false");
    const url =
        `https://www.googleapis.com/drive/v3/files` +
        `?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime)`;

    const res = await driveFetch(url);
    const data = await res.json();
    return data.files?.[0]?.id ?? null;
}

export async function saveBackupToDrive(jsonString) {
    const existingId = await findBackupFileId();

    const metadata = existingId
        ? { name: 'holydrums-backup.json' }
        : { name: 'holydrums-backup.json', parents: ['appDataFolder'] };

    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelim = `\r\n--${boundary}--`;

    const body =
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        jsonString +
        closeDelim;

    const method = existingId ? 'PATCH' : 'POST';
    const url = existingId
        ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
        : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;

    await driveFetch(url, {
        method,
        headers: {
            'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
    });

    return true;
}

export async function loadBackupFromDrive() {
    const fileId = await findBackupFileId();
    if (!fileId) throw new Error('Nenhum backup no Google Drive.');

    const res = await driveFetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
    );
    return await res.text();
}

export async function connectDrive() {
    await getToken(true);
    return true;
}