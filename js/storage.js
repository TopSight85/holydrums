// storage.js

const KEYS = {
    songs:    'holydrums:songs',
    setlists: 'holydrums:setlists',
};

/* ── UTILITÁRIOS INTERNOS ────────────────────────────────────── */

function readJSON(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ── MÚSICAS ─────────────────────────────────────────────────── */

export function getAllSongs() {
    return readJSON(KEYS.songs) ?? [];
}

export function getSongById(id) {
    return getAllSongs().find(s => s.id === id) ?? null;
}

export function saveSong(songData) {
    const songs = getAllSongs();
    const now   = Date.now();

    if (songData.id) {
        const index = songs.findIndex(s => s.id === songData.id);
        if (index === -1) {
            // ID fornecido mas não encontrado — insere como novo
            const newSong = { ...songData, createdAt: now, updatedAt: now };
            songs.push(newSong);
            writeJSON(KEYS.songs, songs);
            return newSong;
        }
        songs[index] = { ...songData, updatedAt: now };
        writeJSON(KEYS.songs, songs);
        return songs[index];
    }

    // Música nova — gera ID
    const newSong = { ...songData, id: generateId(), createdAt: now, updatedAt: now };
    songs.push(newSong);
    writeJSON(KEYS.songs, songs);
    return newSong;
}

export function deleteSong(id) {
    const songs = getAllSongs().filter(s => s.id !== id);
    writeJSON(KEYS.songs, songs);

    // Remove a música de todas as setlists que a contêm
    const setlists = getAllSetlists().map(sl => ({
        ...sl,
        songIds: sl.songIds.filter(sid => sid !== id),
    }));
    writeJSON(KEYS.setlists, setlists);
}

/**
 * Exporta uma única música como uma string JSON.
 * @param {string} id - O ID da música a ser exportada.
 * @returns {string} - A música em formato JSON.
 */
export function exportSong(id) {
    const song = getSongById(id);
    if (!song) {
        throw new Error(`Música com ID ${id} não encontrada.`);
    }
    return JSON.stringify(song, null, 2);
}

/**
 * Importa uma única música a partir de uma string JSON.
 * Se a música já existir (mesmo ID), ela será atualizada.
 * Caso contrário, será adicionada como uma nova música.
 * @param {string} jsonString - A string JSON da música a ser importada.
 * @returns {object} - A música importada/salva.
 */
export function importSong(jsonString) {
    const songData = JSON.parse(jsonString);

    if (!songData || typeof songData !== 'object' || !songData.title) {
        throw new Error('Dados de música inválidos para importação.');
    }

    // Se a música importada tiver um ID, tentamos encontrar e atualizar.
    // Caso contrário, ou se não encontrar, tratamos como nova.
    let existingSong = null;
    if (songData.id) {
        existingSong = getSongById(songData.id);
    }

    if (existingSong) {
        // Atualiza a música existente
        const updatedSong = { ...existingSong, ...songData, updatedAt: Date.now() };
        saveSong(updatedSong); // saveSong já lida com a atualização
        return updatedSong;
    } else {
        // Adiciona como nova música, gerando um novo ID para evitar conflitos
        const newSong = { ...songData, id: generateId(), createdAt: Date.now(), updatedAt: Date.now() };
        saveSong(newSong);
        return newSong;
    }
}


/* ── SETLISTS ────────────────────────────────────────────────── */

export function getAllSetlists() {
    return readJSON(KEYS.setlists) ?? [];
}

export function getSetlistById(id) {
    return getAllSetlists().find(sl => sl.id === id) ?? null;
}

export function getSetlistWithSongs(id) {
    const setlist = getSetlistById(id);
    if (!setlist) return null;

    const songs    = getAllSongs();
    const resolved = setlist.songIds
        .map(sid => songs.find(s => s.id === sid))
        .filter(Boolean);

    return { ...setlist, songs: resolved };
}

export function saveSetlist(setlistData) {
    const setlists = getAllSetlists();
    const now      = Date.now();

    if (setlistData.id) {
        const index = setlists.findIndex(sl => sl.id === setlistData.id);
        if (index === -1) {
            const newSl = { ...setlistData, createdAt: now, updatedAt: now };
            setlists.push(newSl);
            writeJSON(KEYS.setlists, setlists);
            return newSl;
        }
        setlists[index] = { ...setlistData, updatedAt: now };
        writeJSON(KEYS.setlists, setlists);
        return setlists[index];
    }

    const newSl = { ...setlistData, id: generateId(), createdAt: now, updatedAt: now };
    setlists.push(newSl);
    writeJSON(KEYS.setlists, setlists);
    return newSl;
}

export function deleteSetlist(id) {
    const setlists = getAllSetlists().filter(sl => sl.id !== id);
    writeJSON(KEYS.setlists, setlists);
}

export function reorderSetlist(setlistId, orderedSongIds) {
    const setlists = getAllSetlists();
    const index    = setlists.findIndex(sl => sl.id === setlistId);
    if (index === -1) return;

    setlists[index] = {
        ...setlists[index],
        songIds:   orderedSongIds,
        updatedAt: Date.now(),
    };

    writeJSON(KEYS.setlists, setlists);
}

/* ── EXPORTAÇÃO / IMPORTAÇÃO GERAL ─────────────────────────── */

export function exportAll() {
    return JSON.stringify({
        version:  1,
        exportedAt: new Date().toISOString(),
        songs:    getAllSongs(),
        setlists: getAllSetlists(),
    }, null, 2);
}

export function importAll(jsonString) {
    const data = JSON.parse(jsonString);

    if (!data || typeof data !== 'object') {
        throw new Error('Arquivo de backup inválido.');
    }

    if (data.version !== 1) {
        throw new Error(`Versão de backup incompatível: ${data.version}`);
    }

    if (!Array.isArray(data.songs)) {
        throw new Error('Backup sem lista de músicas.');
    }

    writeJSON(KEYS.songs,    data.songs    ?? []);
    writeJSON(KEYS.setlists, data.setlists ?? []);
}