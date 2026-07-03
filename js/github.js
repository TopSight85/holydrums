// github.js — leitura de músicas hospedadas na pasta /songs do repositório público.
// Só leitura: não precisa de token, o repositório é público.

const REPO_OWNER = 'topsight85';
const REPO_NAME  = 'holydrums';
const SONGS_PATH = 'songs';

/**
 * Lista os arquivos .json disponíveis na pasta de músicas do repositório.
 * Retorna os itens crus da Contents API (cada um com "name" e "download_url").
 */
export async function listRepoSongs() {
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${SONGS_PATH}`;
    const res = await fetch(url, {
        headers: { Accept: 'application/vnd.github+json' },
    });

    if (!res.ok) {
        if (res.status === 404) {
            throw new Error(`Pasta "${SONGS_PATH}" não encontrada no repositório.`);
        }
        throw new Error(`GitHub respondeu ${res.status} ao listar as músicas.`);
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
        throw new Error(`"${SONGS_PATH}" não é uma pasta no repositório.`);
    }

    return data.filter(item => item.type === 'file' && item.name.toLowerCase().endsWith('.json'));
}

/** Baixa o conteúdo (texto) de uma música a partir da sua download_url. */
export async function fetchRepoSongContent(downloadUrl) {
    const res = await fetch(downloadUrl);
    if (!res.ok) {
        throw new Error(`Não foi possível baixar o arquivo (${res.status}).`);
    }
    return await res.text();
}
