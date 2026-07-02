// app.js

import { initDrive, connectDrive, saveBackupToDrive, loadBackupFromDrive, isDriveConnectedPref, setDriveConnectedPref } from './drive.js';

import {
    getAllSongs,
    getSongById,
    saveSong,
    deleteSong,
    exportSong, // Importado
    importSong, // Importado
    getAllSetlists,
    getSetlistWithSongs,
    saveSetlist,
    deleteSetlist,
    reorderSetlist,
    exportAll,
    importAll,
} from './storage.js';

import { parseMusicXML, looksLikeMusicXML } from './parser.js';
import {
    waitForOSMD,
    isOSMDReady,
    renderMeasure,
    renderMeasures,
    destroyInstance,
} from './renderer.js';
import {
    buildSheet,
    goToPage,
    nextPage,
    prevPage,
    onPageChanged,
} from './layout.js';

/* ── DETECÇÃO DE TELA ────────────────────────────────────────── */

const PAGE = (() => {
    const path = window.location.pathname;
    // Usar regex para ser mais robusto com subdiretórios no GitHub Pages
    if (/editor/i.test(path))  return 'editor';
    if (/viewer/i.test(path))  return 'viewer';
    return 'index';
})();

document.addEventListener('DOMContentLoaded', () => {
    if (PAGE === 'index')  initIndex();
    if (PAGE === 'editor') initEditor();
    if (PAGE === 'viewer') initViewer();
});

/* ════════════════════════════════════════════════════════════════
 * INDEX
 * ════════════════════════════════════════════════════════════════ */

function initIndex() {
    renderSongList();
    renderSetlistList();

    // Init Drive (não quebra se script/credenciais ainda não estiverem prontos)
    try {
        initDrive();
    } catch (err) {
        console.warn('Drive não inicializado:', err.message);
    }

    bindIndexEvents();
}

function bindIndexEvents() {
    // Nova setlist
    document.getElementById('btn-new-setlist')
        ?.addEventListener('click', handleNewSetlist);

    // Backup local: exportar
    document.getElementById('btn-export')
        ?.addEventListener('click', handleExportAllLocal);

    // Backup local: abrir seletor de arquivo
    document.getElementById('btn-import')
        ?.addEventListener('click', () => {
            document.getElementById('import-file')?.click();
        });

    // Backup local: importar arquivo selecionado
    document.getElementById('import-file')
        ?.addEventListener('change', handleImportAllLocal);

    // Google Drive: conectar
    document.getElementById('btn-drive-connect')
        ?.addEventListener('click', handleDriveConnect);

    // Google Drive: salvar backup
    document.getElementById('btn-drive-save')
        ?.addEventListener('click', handleDriveSave);

    // Google Drive: restaurar backup
    document.getElementById('btn-drive-load')
        ?.addEventListener('click', handleDriveLoad);

    // Define o estado inicial dos botões Drive baseado na persistência
    if (isDriveConnectedPref()) {
        updateDriveUI(true);
    } else {
        updateDriveUI(false);
    }
}

function handleExportAllLocal() {
    try {
        const data = exportAll();
        const blob = new Blob([data], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `holydrums-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();

        URL.revokeObjectURL(url);
    } catch (err) {
        alert(`Erro ao exportar backup: ${err.message}`);
    }
}

async function handleImportAllLocal(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
        const text = await file.text();
        importAll(text);

        alert('Backup importado com sucesso!');
        renderSongList();
        renderSetlistList();
    } catch (err) {
        alert(`Erro ao importar: ${err.message}`);
    } finally {
        // Permite selecionar o mesmo arquivo novamente depois
        e.target.value = '';
    }
}

let driveConnected = false;

function updateDriveUI(connected) {
    driveConnected = connected;

    const btnConnect = document.getElementById('btn-drive-connect');
    const btnSave    = document.getElementById('btn-drive-save');
    const btnLoad    = document.getElementById('btn-drive-load');

    if (btnConnect) {
        if (connected) {
            btnConnect.textContent = 'Desconectar Drive';
            btnConnect.classList.add('btn-drive-disconnect');
        } else {
            btnConnect.textContent = 'Conectar Drive';
            btnConnect.classList.remove('btn-drive-disconnect');
        }
    }

    if (btnSave) {
        btnSave.disabled = !connected;
    }
    if (btnLoad) {
        btnLoad.disabled = !connected;
    }
}

async function handleDriveConnect() {
    if (driveConnected) {
        // Desconectar explicitamente
        setDriveConnectedPref(false);
        updateDriveUI(false);
        return;
    }
    try {
        await connectDrive();
        updateDriveUI(true);
    } catch (err) {
        alert(`Falha ao conectar no Drive: ${err.message}`);
        updateDriveUI(false);
    }
}

async function handleDriveSave() {
    try {
        const data = exportAll();
        await saveBackupToDrive(data);
        alert('Backup salvo no Google Drive com sucesso.');
    } catch (err) {
        alert(`Erro ao salvar no Drive: ${err.message}`);
    }
}

async function handleDriveLoad() {
    try {
        const text = await loadBackupFromDrive();
        importAll(text);

        alert('Backup restaurado do Google Drive com sucesso.');
        renderSongList();
        renderSetlistList();
    } catch (err) {
        alert(`Erro ao restaurar do Drive: ${err.message}`);
    }
}

/* ── MÚSICAS ─────────────────────────────────────────────────── */

function renderSongList() {
    const container = document.getElementById('song-list');
    if (!container) return;

    const songs = getAllSongs();

    if (!songs.length) {
        container.innerHTML = `
            <div class="empty-state">
                <strong>Nenhuma música cadastrada</strong>
                <p>Clique em "Nova música" para começar.</p>
            </div>`;
        return;
    }

    container.innerHTML = '';
    songs
        .sort((a, b) => a.title.localeCompare(b.title))
        .forEach(song => container.appendChild(buildSongCard(song)));
}

function buildSongCard(song) {
    const card = document.createElement('a');
    card.className = 'song-card';
    card.href      = `viewer.html?song=${song.id}`;

    const bpmLabel  = song.tempo?.bpm ? `${song.tempo.bpm} BPM` : '';
    const noteLabel = song.tempo?.note === 'half'   ? '𝅗𝅥'
                    : song.tempo?.note === 'eighth' ? '♪' : '♩';

    card.innerHTML = `
        <div class="song-card-info">
            <div class="song-card-title">${escapeHTML(song.title)}</div>
            <div class="song-card-artist">${escapeHTML(song.artist || '')}</div>
        </div>
        <div class="song-card-tempo">
            ${bpmLabel ? `${noteLabel} = ${bpmLabel}` : ''}
        </div>
        <div class="song-card-actions">
            <button class="icon-btn" data-action="export-song" data-id="${song.id}"
                    title="Exportar música" aria-label="Exportar música">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2.2"
                     stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
            </button>
            <button class="icon-btn" data-action="import-song" data-id="${song.id}"
                    title="Importar música (atualizar)" aria-label="Importar música">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2.2"
                     stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
            </button>
            <button class="icon-btn" data-action="edit" data-id="${song.id}"
                    title="Editar" aria-label="Editar">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2.2"
                     stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
            </button>
            <button class="icon-btn danger" data-action="delete" data-id="${song.id}"
                    title="Excluir" aria-label="Excluir">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2.2"
                     stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14H6L5 6"/>
                    <path d="M10 11v6M14 11v6"/>
                    <path d="M9 6V4h6v2"/>
                </svg>
            </button>
        </div>`;

    card.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.preventDefault();
            e.stopPropagation();
            const { action, id } = btn.dataset;

            if (action === 'edit') {
                window.location.href = `editor.html?song=${id}`;
            } else if (action === 'delete') {
                handleDeleteSong(id);
            } else if (action === 'export-song') {
                handleExportSong(id);
            } else if (action === 'import-song') {
                await handleImportSong(id);
            }
        });
    });

    return card;
}

function handleDeleteSong(id) {
    const song = getSongById(id);
    if (!song) return;
    if (!confirm(`Excluir "${song.title}"? Esta ação não pode ser desfeita.`)) return;
    deleteSong(id);
    renderSongList();
    renderSetlistList();
}

function handleExportSong(id) {
    try {
        const data = exportSong(id);
        const song = getSongById(id);
        const blob = new Blob([data], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `holydrums-song-${song.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        alert(`Música "${song.title}" exportada com sucesso!`);
    } catch (err) {
        alert(`Erro ao exportar música: ${err.message}`);
    }
}

async function handleImportSong(id) {
    const song = getSongById(id);
    if (!song) {
        alert('Música não encontrada para atualização.');
        return;
    }

    if (!confirm(`Importar e atualizar a música "${song.title}"? Isso substituirá os dados atuais.`)) {
        return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.style.display = 'none';

    input.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const imported = importSong(text); // A função importSong já lida com a atualização se o ID for o mesmo
            alert(`Música "${imported.title}" importada e atualizada com sucesso!`);
            renderSongList();
            renderSetlistList();
        } catch (err) {
            alert(`Erro ao importar música: ${err.message}`);
        }
    });

    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
}


/* ── SETLISTS ─────────────────────────────────────────────────── */

function renderSetlistList() {
    const container = document.getElementById('setlist-list');
    if (!container) return;

    const setlists = getAllSetlists();

    if (!setlists.length) {
        container.innerHTML = `
            <div class="empty-state">
                <strong>Nenhuma setlist criada</strong>
                <p>Organize as músicas por culto aqui.</p>
            </div>`;
        return;
    }

    container.innerHTML = '';
    setlists
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        .forEach(sl => container.appendChild(buildSetlistCard(sl)));
}

function buildSetlistCard(setlist) {
    const resolved = getSetlistWithSongs(setlist.id);
    const songs    = resolved?.songs ?? [];

    const card = document.createElement('div');
    card.className = 'setlist-card';

    const dateLabel = setlist.date
        ? new Date(setlist.date + 'T00:00:00').toLocaleDateString('pt-BR')
        : '';

    const songsHTML = songs.length
        ? songs.map(s => `
            <div class="setlist-song-item">${escapeHTML(s.title)}</div>`).join('')
        : `<div class="setlist-song-item" style="font-style:italic">
               Nenhuma música adicionada
           </div>`;

    card.innerHTML = `
        <div class="setlist-card-header">
            <div class="setlist-card-title">${escapeHTML(setlist.name)}</div>
            <div style="display:flex;align-items:center;gap:8px">
                <span class="setlist-card-date">${dateLabel}</span>
                <button class="icon-btn" data-action="add-songs" title="Adicionar músicas">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2.3"
                         stroke-linecap="round" stroke-linejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                </button>
                <button class="icon-btn" data-action="play" title="Executar setlist">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2.2"
                         stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                </button>
                <button class="icon-btn danger" data-action="delete" title="Excluir setlist">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2.2"
                         stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6l-1 14H6L5 6"/>
                        <path d="M10 11v6M14 11v6"/>
                        <path d="M9 6V4h6v2"/>
                    </svg>
                </button>
            </div>
        </div>
        <div class="setlist-songs">${songsHTML}</div>`;

    card.querySelector('[data-action="play"]')?.addEventListener('click', () => {
        if (!songs.length) { alert('Adicione músicas à setlist antes de executar.'); return; }
        window.location.href = `viewer.html?setlist=${setlist.id}`;
    });

    card.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
        if (!confirm(`Excluir setlist "${setlist.name}"?`)) return;
        deleteSetlist(setlist.id);
        renderSetlistList();
    });

    card.querySelector('[data-action="add-songs"]')?.addEventListener('click', () => {
        openSetlistEditor(setlist.id);
    });

    return card;
}

function handleNewSetlist() {
    const name = prompt('Nome da setlist (ex: Culto 29/06):');
    if (!name?.trim()) return;
    const date = prompt('Data do culto (AAAA-MM-DD) — opcional:') || '';
    saveSetlist({ name: name.trim(), date: date.trim(), songIds: [] });
    renderSetlistList();
}

function openSetlistEditor(setlistId) {
    const resolved = getSetlistWithSongs(setlistId);
    if (!resolved) return;

    const allSongs = getAllSongs().sort((a, b) => a.title.localeCompare(b.title));
    const songById = new Map(allSongs.map(s => [s.id, s]));

    // Estado local — só é persistido se o usuário clicar em "Salvar"
    let selectedIds = resolved.songIds.filter(id => songById.has(id));
    let searchTerm  = '';
    let draggedId   = null;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal setlist-picker-modal">
            <div class="modal-header">
                <div class="modal-title">${escapeHTML(resolved.name)}</div>
                <button class="icon-btn" data-action="close" title="Fechar">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2.2"
                         stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
            <div class="picker-body">
                <div class="picker-col">
                    <div class="picker-col-title">Todas as músicas</div>
                    <input type="text" class="field-input picker-search" placeholder="Buscar música...">
                    <div class="picker-list" id="picker-available"></div>
                </div>
                <div class="picker-col">
                    <div class="picker-col-title">Na setlist (<span id="picker-count">0</span>)</div>
                    <div class="picker-list" id="picker-selected"></div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="topbar-btn secondary" data-action="close">Cancelar</button>
                <button class="topbar-btn primary" data-action="save">Salvar setlist</button>
            </div>
        </div>`;

    document.body.appendChild(overlay);

    const availableEl = overlay.querySelector('#picker-available');
    const selectedEl  = overlay.querySelector('#picker-selected');
    const countEl     = overlay.querySelector('#picker-count');
    const searchEl    = overlay.querySelector('.picker-search');

    function renderAvailable() {
        const term = searchTerm.trim().toLowerCase();
        const items = allSongs.filter(s => {
            if (selectedIds.includes(s.id)) return false;
            if (!term) return true;
            return s.title.toLowerCase().includes(term) ||
                   (s.artist || '').toLowerCase().includes(term);
        });

        if (!items.length) {
            availableEl.innerHTML = `<div class="picker-empty">Nenhuma música encontrada</div>`;
            return;
        }

        availableEl.innerHTML = items.map(s => `
            <div class="picker-item" data-id="${s.id}">
                <div class="picker-item-info">
                    <div class="picker-item-title">${escapeHTML(s.title)}</div>
                    ${s.artist ? `<div class="picker-item-artist">${escapeHTML(s.artist)}</div>` : ''}
                </div>
                <span class="picker-add-btn" title="Adicionar">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2.3"
                         stroke-linecap="round" stroke-linejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                </span>
            </div>`).join('');

        availableEl.querySelectorAll('.picker-item').forEach(el => {
            el.addEventListener('click', () => {
                const id = el.dataset.id;
                selectedIds.push(id);
                renderAvailable();
                renderSelected();
            });
        });
    }

    function renderSelected() {
        countEl.textContent = selectedIds.length;

        if (!selectedIds.length) {
            selectedEl.innerHTML = `<div class="picker-empty">Clique em uma música à esquerda para adicionar</div>`;
            return;
        }

        selectedEl.innerHTML = selectedIds.map((id, idx) => {
            const s = songById.get(id);
            if (!s) return '';
            return `
            <div class="picker-item picker-selected-item" draggable="true" data-id="${id}">
                <span class="drag-handle" title="Arrastar para reordenar">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/>
                        <circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/>
                        <circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>
                    </svg>
                </span>
                <span class="picker-order-num">${idx + 1}</span>
                <div class="picker-item-info">
                    <div class="picker-item-title">${escapeHTML(s.title)}</div>
                    ${s.artist ? `<div class="picker-item-artist">${escapeHTML(s.artist)}</div>` : ''}
                </div>
                <button class="icon-btn danger picker-remove-btn" title="Remover">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2.2"
                         stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>`;
        }).join('');

        selectedEl.querySelectorAll('.picker-remove-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                const id = e.currentTarget.closest('.picker-item').dataset.id;
                selectedIds = selectedIds.filter(sid => sid !== id);
                renderAvailable();
                renderSelected();
            });
        });

        selectedEl.querySelectorAll('.picker-selected-item').forEach(el => {
            el.addEventListener('dragstart', e => {
                draggedId = el.dataset.id;
                el.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });
            el.addEventListener('dragend', () => {
                el.classList.remove('dragging');
                draggedId = null;
            });
        });
    }

    selectedEl.addEventListener('dragover', e => {
        e.preventDefault();
        if (!draggedId) return;

        const draggedEl = selectedEl.querySelector(`.picker-selected-item[data-id="${draggedId}"]`);
        const target = e.target.closest('.picker-selected-item');
        if (!draggedEl || !target || target === draggedEl) return;

        const rect   = target.getBoundingClientRect();
        const before = e.clientY - rect.top < rect.height / 2;
        target.parentNode.insertBefore(draggedEl, before ? target : target.nextSibling);
    });

    selectedEl.addEventListener('drop', e => {
        e.preventDefault();
        if (!draggedId) return;
        selectedIds = Array.from(selectedEl.querySelectorAll('.picker-selected-item'))
            .map(el => el.dataset.id);
        draggedId = null;
        renderSelected();
    });

    searchEl.addEventListener('input', e => {
        searchTerm = e.target.value;
        renderAvailable();
    });

    function close() {
        overlay.remove();
        document.removeEventListener('keydown', onKeydown);
    }

    function onKeydown(e) {
        if (e.key === 'Escape') close();
    }

    overlay.addEventListener('click', e => {
        if (e.target === overlay) close();
    });
    overlay.querySelectorAll('[data-action="close"]').forEach(btn => {
        btn.addEventListener('click', close);
    });
    overlay.querySelector('[data-action="save"]').addEventListener('click', () => {
        reorderSetlist(setlistId, selectedIds);
        renderSetlistList();
        close();
    });
    document.addEventListener('keydown', onKeydown);

    renderAvailable();
    renderSelected();
}

/* ════════════════════════════════════════════════════════════════
 * EDITOR
 * ════════════════════════════════════════════════════════════════ */

let editorState = {
    song:        null,
    musicXML:    null,
    parsedScore: null, // cache do MusicXML parseado, usado nas prévias de compasso
    sections:    [],
};

// Referências aos cards de prévia atualmente na tela (recriadas a cada renderSections)
let markPreviewRefs = [];

// IDs de trechos cuja prévia está "ativa" (renderizada ou para re-renderizar
// automaticamente após um rebuild da lista de seções)
let renderedPreviewIds = new Set();

function initEditor() {
    const params = new URLSearchParams(window.location.search);
    const songId = params.get('song');

    // ── Botão Visualizar: aponta para o viewer ou desabilita se música nova ──
    const btnView = document.getElementById('btn-view');
    if (btnView) {
        if (songId) {
            btnView.href = `viewer.html?song=${songId}`;
        } else {
            btnView.style.opacity       = '0.4';
            btnView.style.pointerEvents = 'none';
            btnView.title = 'Salve a música antes de visualizar';
        }
    }

    if (songId) {
        const song = getSongById(songId);
        if (song) loadSongIntoEditor(song);
    }

    bindEditorEvents();
    setupDragAndDrop(); // Configura o drag and drop para seções e trechos
}

function loadSongIntoEditor(song) {
    editorState.song        = song;
    editorState.musicXML    = song.musicXML
        ? decodeHTMLEntities(song.musicXML)
        : null;
    editorState.parsedScore = null;
    editorState.sections    = structuredClone(song.sections ?? []);

    setValue('song-title',  song.title  ?? '');
    setValue('song-artist', song.artist ?? '');
    setValue('song-link',   song.link   ?? '');
    setValue('tempo-bpm',   song.tempo?.bpm  ?? 80);
    setValue('tempo-note',  song.tempo?.note ?? 'quarter');

    if (song.musicXML) showFilename(song.title + '.xml');

    // Ao abrir o editor com uma partitura já vinculada, os trechos com
    // compasso definido já entram marcados para prévia automática —
    // mesmo comportamento de abertura do viewer.
    renderedPreviewIds = new Set(
        editorState.sections
            .flatMap(s => s.marks)
            .filter(m => m.measureStart)
            .map(m => m.id)
    );

    renderSections();
}

function bindEditorEvents() {
    document.getElementById('btn-save')
        ?.addEventListener('click', handleSave);

    document.getElementById('file-input')
        ?.addEventListener('change', handleFileUpload);

    const zone = document.getElementById('upload-zone');
    if (zone) {
        zone.addEventListener('dragover', e => {
            e.preventDefault();
            zone.style.borderColor = 'var(--text-secondary)';
        });
        zone.addEventListener('dragleave', () => {
            zone.style.borderColor = '';
        });
        zone.addEventListener('drop', e => {
            e.preventDefault();
            zone.style.borderColor = '';
            const file = e.dataTransfer.files[0];
            if (file) processFile(file);
        });
    }

    document.getElementById('btn-add-section')
        ?.addEventListener('click', () => {
            editorState.sections.push({
                id:    generateId(),
                name:  'Nova seção',
                marks: [],
            });
            renderSections();
        });

    document.getElementById('btn-preview-all')
        ?.addEventListener('click', handlePreviewAll);

    // ── Alternar layout dos trechos (letra/groove lado a lado ↔ empilhados) ──
    const sectionsList = document.getElementById('sections-list');
    const btnLayout = document.getElementById('btn-layout');
    if (btnLayout && sectionsList) {
        const applyLayout = compact => {
            sectionsList.classList.toggle('compact-layout', compact);
            btnLayout.classList.toggle('active', compact);
        };

        applyLayout(localStorage.getItem('holydrums_editor_layout') === 'compact');

        btnLayout.addEventListener('click', () => {
            const isCompact = !sectionsList.classList.contains('compact-layout');
            localStorage.setItem('holydrums_editor_layout', isCompact ? 'compact' : 'default');
            applyLayout(isCompact);
        });
    }

    // ── Botão Fullscreen ──
    document.getElementById('btn-fullscreen')
        ?.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(err => {
                    console.warn(`Erro ao ativar tela cheia: ${err.message}`);
                });
            } else {
                document.exitFullscreen();
            }
        });
}

async function handlePreviewAll() {
    const btn = document.getElementById('btn-preview-all');

    if (!editorState.musicXML) {
        alert('Envie um arquivo MusicXML antes de gerar a prévia dos compassos.');
        return;
    }

    const targets = markPreviewRefs.filter(ref => ref.getMark().measureStart);
    if (!targets.length) {
        alert('Nenhum trecho com compasso definido para gerar prévia.');
        return;
    }

    targets.forEach(ref => renderedPreviewIds.add(ref.getMark().id));

    btn?.classList.add('loading');
    try {
        await Promise.all(
            targets.map(ref => renderMarkPreview(ref.card, ref.getMark()))
        );
    } finally {
        btn?.classList.remove('loading');
    }
}

async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (file) await processFile(file);
}

async function processFile(file) {
    const text = await file.text();

    if (!looksLikeMusicXML(text)) {
        alert('O arquivo não parece ser um MusicXML válido. Exporte como MusicXML Descompactado (*.xml) no MuseScore.');
        return;
    }

    try {
        await parseMusicXML(text);
        editorState.musicXML    = text;
        editorState.parsedScore = null; // nova partitura: invalida cache de parse
        renderedPreviewIds.clear();     // e qualquer prévia antiga perde sentido
        showFilename(file.name);
        renderSections(); // reconstrói os cards de prévia zerados para a nova partitura
    } catch (err) {
        alert(`Erro ao ler o arquivo: ${err.message}`);
    }
}

function showFilename(name) {
    const el = document.getElementById('upload-filename');
    if (!el) return;
    el.textContent   = `✓ ${name}`;
    el.style.display = 'block';
}

/* ── PRÉVIA DE COMPASSOS ─────────────────────────────────────── */

/** Faz o parse do MusicXML uma única vez e reaproveita o resultado. */
async function getParsedScore() {
    if (!editorState.musicXML) return null;
    if (editorState.parsedScore) return editorState.parsedScore;

    try {
        editorState.parsedScore = await parseMusicXML(editorState.musicXML);
    } catch (err) {
        console.warn('editor: erro ao parsear MusicXML para prévia', err);
        editorState.parsedScore = null;
    }
    return editorState.parsedScore;
}

/** Renderiza (ou re-renderiza) a prévia de um único trecho dentro do seu card. */
async function renderMarkPreview(card, mark) {
    if (!card) return;

    // Sempre libera qualquer instância OSMD anterior antes de decidir o novo conteúdo
    destroyInstance(card);
    card.classList.remove('has-content');

    if (!editorState.musicXML) {
        card.classList.add('has-content');
        card.innerHTML = '<span class="mark-preview-msg">Sem partitura</span>';
        return;
    }

    if (!mark.measureStart) {
        card.classList.add('has-content');
        card.innerHTML = '<span class="mark-preview-msg">Sem compasso definido</span>';
        return;
    }

    const parsed = await getParsedScore();
    if (!parsed) {
        card.classList.add('has-content');
        card.innerHTML = '<span class="mark-preview-msg">Erro ao ler partitura</span>';
        return;
    }

    const start = mark.measureStart;
    const end   = mark.measureEnd ?? mark.measureStart;
    const measures = parsed.measures.filter(m => m.number >= start && m.number <= end);

    if (!measures.length) {
        card.classList.add('has-content');
        card.innerHTML = `<span class="mark-preview-msg">C.${start}${end !== start ? `–${end}` : ''} não encontrado</span>`;
        return;
    }

    card.classList.add('loading');
    try {
        if (!isOSMDReady()) await waitForOSMD();

        // OSMD precisa que o container já tenha width real > 0 para renderizar
        await new Promise(resolve => requestAnimationFrame(resolve));

        if (measures.length === 1) {
            await renderMeasure(card, measures[0], editorState.musicXML);
        } else {
            await renderMeasures(card, measures, editorState.musicXML);
        }
        card.classList.add('has-content');
    } catch (err) {
        console.warn('editor: erro ao renderizar prévia do trecho', err);
        card.innerHTML = '<span class="mark-preview-msg">Erro ao renderizar</span>';
        card.classList.add('has-content');
    } finally {
        card.classList.remove('loading');
    }
}

/** Re-renderiza somente as prévias que já estavam ativas (evita custo de renderizar tudo sempre). */
function renderVisiblePreviews() {
    if (!editorState.musicXML || !renderedPreviewIds.size) return;

    markPreviewRefs
        .filter(ref => renderedPreviewIds.has(ref.getMark().id))
        .forEach(ref => renderMarkPreview(ref.card, ref.getMark()));
}

/* ── SEÇÕES ──────────────────────────────────────────────────── */

function renderSections() {
    const container = document.getElementById('sections-list');
    if (!container) return;

    // Libera as instâncias OSMD dos cards de prévia antes de descartar o DOM antigo
    container.querySelectorAll('[data-render-target]').forEach(el => destroyInstance(el));

    container.innerHTML = '';
    markPreviewRefs = [];

    editorState.sections.forEach((section, sIdx) => {
        container.appendChild(buildSectionItem(section, sIdx));
    });

    // Restaura (sem forçar tudo) apenas as prévias que já estavam ativas
    renderVisiblePreviews();
}

function buildSectionItem(section, sIdx) {
    const item = document.createElement('div');
    item.className   = 'section-item';
    item.dataset.idx = sIdx;
    item.draggable   = true; // Habilita drag para a seção

    const header = document.createElement('div');
    header.className = 'section-item-header';
    header.innerHTML = `
        <span class="drag-handle" title="Arrastar para reordenar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
                <line x1="8"  y1="6"  x2="21" y2="6"/>
                <line x1="8"  y1="12" x2="21" y2="12"/>
                <line x1="8"  y1="18" x2="21" y2="18"/>
                <line x1="3"  y1="6"  x2="3.01" y2="6"/>
                <line x1="3"  y1="12" x2="3.01" y2="12"/>
                <line x1="3"  y1="18" x2="3.01" y2="18"/>
            </svg>
        </span>
        <input type="text" value="${escapeHTML(section.name)}"
               placeholder="Nome da seção">`;

    // ── Botão duplicar seção ──
    const dupSectionBtn = document.createElement('button');
    dupSectionBtn.className = 'icon-btn';
    dupSectionBtn.title     = 'Duplicar seção';
    dupSectionBtn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.2"
             stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2"/>
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
        </svg>`;

    dupSectionBtn.addEventListener('click', () => {
        const clone  = structuredClone(editorState.sections[sIdx]);
        clone.id     = generateId();
        clone.name   = clone.name + ' (cópia)';
        clone.marks  = clone.marks.map(m => ({ ...m, id: generateId() })); // Duplica IDs dos marks também
        editorState.sections.splice(sIdx + 1, 0, clone);
        renderSections();
    });

    // ── Botão remover seção ──
    const removeSectionBtn = document.createElement('button');
    removeSectionBtn.className = 'icon-btn danger';
    removeSectionBtn.title     = 'Remover seção';
    removeSectionBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.2"
             stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4h6v2"/>
        </svg>`;

    removeSectionBtn.addEventListener('click', () => {
        if (!confirm('Remover esta seção e todos os seus trechos?')) return;
        editorState.sections.splice(sIdx, 1);
        renderSections();
    });

    header.querySelector('input').addEventListener('input', e => {
        editorState.sections[sIdx].name = e.target.value;
    });

    header.appendChild(dupSectionBtn);
    header.appendChild(removeSectionBtn);

    const body = document.createElement('div');
    body.className = 'section-item-body';

    const marksList = document.createElement('div');
    marksList.className = 'marks-list';
    marksList.dataset.sectionIdx = sIdx; // Para identificar a seção pai no drag and drop

    section.marks.forEach((mark, mIdx) => {
        marksList.appendChild(buildMarkItem(mark, sIdx, mIdx));
    });

    const addMarkBtn = document.createElement('button');
    addMarkBtn.className = 'add-mark-btn';
    addMarkBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5"  y1="12" x2="19" y2="12"/>
        </svg>
        Adicionar trecho`;

    addMarkBtn.addEventListener('click', () => {
        editorState.sections[sIdx].marks.push({
            id:     generateId(),
            groove: 'nd',
            lyrics: '',
        });
        renderSections();
    });

    body.appendChild(marksList);
    body.appendChild(addMarkBtn);
    item.appendChild(header);
    item.appendChild(body);

    return item;
}

function buildMarkItem(mark, sIdx, mIdx) {
    const GROOVES = ['nd','g1','g2','g3','g4','g5','g6','g7','g8','g9','g10','g11','g12'];

    const item = document.createElement('div');
    item.className     = 'mark-item';
    item.dataset.sIdx  = sIdx; // Índice da seção pai
    item.dataset.mIdx  = mIdx; // Índice do mark
    item.draggable     = true; // Habilita drag para o trecho

    const dragHandle = document.createElement('span');
    dragHandle.className = 'drag-handle';
    dragHandle.title = 'Arrastar trecho';
    dragHandle.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
            <line x1="8"  y1="6"  x2="21" y2="6"/>
            <line x1="8"  y1="12" x2="21" y2="12"/>
            <line x1="8"  y1="18" x2="21" y2="18"/>
            <line x1="3"  y1="6"  x2="3.01" y2="6"/>
            <line x1="3"  y1="12" x2="3.01" y2="12"/>
            <line x1="3"  y1="18" x2="3.01" y2="18"/>
        </svg>`;

    const grooveLetter = mark.groove === 'nd'
        ? 'ND'
        : ['A','B','C','D','E','F','G','H','I','J','K','L'][parseInt(mark.groove.replace('g', ''), 10) - 1] || '';

    // ── Botão de cor/groove ──
    const colorBtn = document.createElement('button');
    colorBtn.className = `mark-color-btn ${mark.groove}`;
    colorBtn.title     = `Clique para trocar o groove (${grooveLetter})`;
    colorBtn.textContent = grooveLetter;

    colorBtn.addEventListener('click', () => {
        const idx  = GROOVES.indexOf(mark.groove);
        const next = GROOVES[(idx + 1) % GROOVES.length];
        editorState.sections[sIdx].marks[mIdx].groove = next;
        colorBtn.className = `mark-color-btn ${next}`;
        const nextLetter = next === 'nd'
            ? 'ND'
            : ['A','B','C','D','E','F','G','H','I','J','K','L'][parseInt(next.replace('g', ''), 10) - 1] || '';
        colorBtn.textContent = nextLetter;
        colorBtn.title = `Clique para trocar o groove (${nextLetter})`;

        // Mantém a cor do card de prévia sincronizada com o groove atual
        const nextColorClass = next === 'nd' ? 'nnd' : 'n' + next.replace('g', '');
        previewCard.className =
            `mark-preview-card ${nextColorClass}` + (previewCard.classList.contains('has-content') ? ' has-content' : '');
    });

    // ── Card de prévia do compasso (clicável, entre a letra e os campos de compasso) ──
    const previewColorClass = mark.groove === 'nd' ? 'nnd' : 'n' + mark.groove.replace('g', '');
    const previewCard = document.createElement('div');
    previewCard.className = `mark-preview-card ${previewColorClass}`;
    previewCard.dataset.renderTarget = 'true';
    previewCard.title = 'Clique para gerar/atualizar a prévia deste compasso';
    previewCard.innerHTML = `
        <div class="mark-preview-placeholder">
            <svg class="mark-preview-icon" width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.2"
                 stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/>
                <circle cx="12" cy="12" r="3"/>
            </svg>
            <span>Prévia</span>
        </div>`;

    previewCard.addEventListener('click', () => {
        const currentMark = editorState.sections[sIdx].marks[mIdx];
        renderedPreviewIds.add(currentMark.id);
        renderMarkPreview(previewCard, currentMark);
    });

    markPreviewRefs.push({
        card:    previewCard,
        getMark: () => editorState.sections[sIdx].marks[mIdx],
    });

    // ── Textarea de letra ──
    const textarea = document.createElement('textarea');
    textarea.className   = 'mark-textarea';
    textarea.placeholder = 'Cole a letra deste trecho aqui…';
    textarea.value       = mark.lyrics ?? '';

    textarea.addEventListener('input', e => {
        editorState.sections[sIdx].marks[mIdx].lyrics = e.target.value;
        e.target.style.height = 'auto';
        e.target.style.height = e.target.scrollHeight + 'px';
    });

    // Auto-resize inicial
    setTimeout(() => {
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
    }, 0);

    // ── Inputs de compasso ──
    const measureWrap = document.createElement('div');
    measureWrap.className = 'mark-measure-wrap';

    const measureStart = document.createElement('input');
    measureStart.type        = 'number';
    measureStart.min         = '1';
    measureStart.placeholder = 'C.ini';
    measureStart.title       = 'Compasso inicial';
    measureStart.value       = mark.measureStart ?? '';
    measureStart.className   = 'mark-measure-input';

    const measureEnd = document.createElement('input');
    measureEnd.type        = 'number';
    measureEnd.min         = '1';
    measureEnd.placeholder = 'C.fim';
    measureEnd.title       = 'Compasso final';
    measureEnd.value       = mark.measureEnd ?? '';
    measureEnd.className   = 'mark-measure-input';

    const measureLabel = document.createElement('span');
    measureLabel.textContent = '↕';
    measureLabel.className   = 'mark-measure-sep';

    measureStart.addEventListener('input', e => {
        editorState.sections[sIdx].marks[mIdx].measureStart =
            parseInt(e.target.value, 10) || null;
    });

    measureEnd.addEventListener('input', e => {
        editorState.sections[sIdx].marks[mIdx].measureEnd =
            parseInt(e.target.value, 10) || null;
    });

    // Ao confirmar a alteração (blur/change), atualiza a prévia se ela já estava ativa
    [measureStart, measureEnd].forEach(input => {
        input.addEventListener('change', () => {
            const currentMark = editorState.sections[sIdx].marks[mIdx];
            if (renderedPreviewIds.has(currentMark.id)) {
                renderMarkPreview(previewCard, currentMark);
            }
        });
    });

    measureWrap.appendChild(measureStart);
    measureWrap.appendChild(measureLabel);
    measureWrap.appendChild(measureEnd);

    // ── Botão duplicar trecho ──
    const dupMarkBtn = document.createElement('button');
    dupMarkBtn.className = 'icon-btn mark-dup-btn';
    dupMarkBtn.title     = 'Duplicar trecho';
    dupMarkBtn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.2"
             stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2"/>
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
        </svg>`;

    dupMarkBtn.addEventListener('click', () => {
        const clone = { ...editorState.sections[sIdx].marks[mIdx], id: generateId() };
        editorState.sections[sIdx].marks.splice(mIdx + 1, 0, clone);
        renderSections();
    });

    // ── Botão remover trecho ──
    const removeBtn = document.createElement('button');
    removeBtn.className = 'icon-btn danger mark-remove-btn';
    removeBtn.title     = 'Remover trecho';
    removeBtn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.2"
             stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6"  x2="6"  y2="18"/>
            <line x1="6"  y1="6"  x2="18" y2="18"/>
        </svg>`;

    removeBtn.addEventListener('click', () => {
        editorState.sections[sIdx].marks.splice(mIdx, 1);
        renderSections();
    });

    const leftControls = document.createElement('div');
    leftControls.className = 'mark-left-controls';
    leftControls.appendChild(dragHandle);
    leftControls.appendChild(colorBtn);
    item.appendChild(leftControls);

    const lyricPreviewWrap = document.createElement('div');
    lyricPreviewWrap.className = 'mark-lyric-preview-wrap';
    lyricPreviewWrap.appendChild(textarea);
    lyricPreviewWrap.appendChild(previewCard);
    item.appendChild(lyricPreviewWrap);

    const rightControls = document.createElement('div');
    rightControls.className = 'mark-right-controls';
    rightControls.appendChild(measureWrap);
    rightControls.appendChild(dupMarkBtn);
    rightControls.appendChild(removeBtn);
    item.appendChild(rightControls);

    return item;
}

/* ── DRAG AND DROP ───────────────────────────────────────────── */

let draggedItem = null;

function setupDragAndDrop() {
    const sectionsList = document.getElementById('sections-list');
    if (!sectionsList) return;

    sectionsList.addEventListener('dragstart', e => {
        if (e.target.classList.contains('section-item')) {
            draggedItem = { type: 'section', el: e.target, idx: parseInt(e.target.dataset.idx, 10) };
            e.dataTransfer.effectAllowed = 'move';
            e.target.classList.add('dragging');
        } else if (e.target.classList.contains('mark-item')) {
            draggedItem = {
                type: 'mark',
                el: e.target,
                sIdx: parseInt(e.target.dataset.sIdx, 10),
                mIdx: parseInt(e.target.dataset.mIdx, 10)
            };
            e.dataTransfer.effectAllowed = 'move';
            e.target.classList.add('dragging');
        }
    });

    // Drag move: handle both sections and marks; allow moving marks across sections
    sectionsList.addEventListener('dragover', e => {
        e.preventDefault();
        if (!draggedItem) return;

        const targetMark = e.target.closest('.mark-item');
        const targetSection = e.target.closest('.section-item');
        let targetMarksList = e.target.closest('.marks-list');

        if (!targetMarksList && targetSection) {
            targetMarksList = targetSection.querySelector('.marks-list');
        }

        // Move sections as before
        if (draggedItem.type === 'section' && targetSection) {
            const bounding = targetSection.getBoundingClientRect();
            const offset   = bounding.y + (bounding.height / 2);
            if (e.clientY - offset > 0) targetSection.after(draggedItem.el);
            else targetSection.before(draggedItem.el);
            return;
        }

        // Move marks: allow between sections
        if (draggedItem.type === 'mark') {
            if (targetMark && targetMark !== draggedItem.el) {
                const bounding = targetMark.getBoundingClientRect();
                const offset   = bounding.y + (bounding.height / 2);
                if (e.clientY - offset > 0) targetMark.after(draggedItem.el);
                else targetMark.before(draggedItem.el);
                return;
            }

            if (targetMarksList) {
                // Try to insert before the first child whose midpoint is below the cursor
                let inserted = false;
                for (const child of Array.from(targetMarksList.children)) {
                    if (!child.classList.contains('mark-item')) continue;
                    const rect = child.getBoundingClientRect();
                    if (e.clientY < rect.top + rect.height / 2) {
                        targetMarksList.insertBefore(draggedItem.el, child);
                        inserted = true;
                        break;
                    }
                }
                if (!inserted) targetMarksList.appendChild(draggedItem.el);
                return;
            }
        }
    });

    // Visual feedback: highlight marks-list targets
    sectionsList.addEventListener('dragenter', e => {
        const ml = e.target.closest('.marks-list');
        if (ml) ml.classList.add('drag-over');
    });
    sectionsList.addEventListener('dragleave', e => {
        const ml = e.target.closest('.marks-list');
        if (ml) ml.classList.remove('drag-over');
    });

    // Drop finalization
    sectionsList.addEventListener('drop', e => {
        e.preventDefault();
        // remove any drag-over visuals
        document.querySelectorAll('.marks-list.drag-over').forEach(el => el.classList.remove('drag-over'));

        if (draggedItem && draggedItem.type === 'mark') {
            let dropMarksList = e.target.closest('.marks-list');
            const dropSection = e.target.closest('.section-item');
            if (!dropMarksList && dropSection) {
                dropMarksList = dropSection.querySelector('.marks-list');
            }
            if (dropMarksList && draggedItem.el.parentNode !== dropMarksList) {
                dropMarksList.appendChild(draggedItem.el);
            }
        }

        if (draggedItem) {
            draggedItem.el.classList.remove('dragging');
            draggedItem = null;
            updateOrder();
        }
    });

    // dragend fallback
    sectionsList.addEventListener('dragend', e => {
        document.querySelectorAll('.marks-list.drag-over').forEach(el => el.classList.remove('drag-over'));
        if (draggedItem) {
            draggedItem.el.classList.remove('dragging');
            draggedItem = null;
            updateOrder();
        }
    });
}

function updateOrder() {
    const newSections = [];
    document.querySelectorAll('.section-item').forEach(sectionEl => {
        const sIdx = parseInt(sectionEl.dataset.idx, 10);
        const originalSection = editorState.sections[sIdx];

        const newMarks = [];
        sectionEl.querySelectorAll('.mark-item').forEach(markEl => {
            const originalSIdx = parseInt(markEl.dataset.sIdx, 10);
            const originalMIdx = parseInt(markEl.dataset.mIdx, 10);
            newMarks.push(editorState.sections[originalSIdx].marks[originalMIdx]);
        });

        newSections.push({ ...originalSection, marks: newMarks });
    });
    editorState.sections = newSections;
    renderSections(); // Re-renderiza para atualizar os data-idx e data-mIdx
}

/* ── SALVAR ──────────────────────────────────────────────────── */

function handleSave() {
    const title  = getValue('song-title').trim();
    const artist = getValue('song-artist').trim();

    if (!title) { alert('Informe o nome da música.'); return; }

    const songData = {
        ...(editorState.song ?? {}),
        title,
        artist,
        link:     getValue('song-link').trim(),
        tempo:    {
            note: getValue('tempo-note'),
            bpm:  parseInt(getValue('tempo-bpm'), 10) || 80,
        },
        musicXML: editorState.musicXML,
        sections: editorState.sections,
    };

    const saved = saveSong(songData); // saveSong agora retorna o objeto salvo

    // Atualiza o botão Visualizar com o ID recém-gerado (caso seja música nova)
    const btnView = document.getElementById('btn-view');
    if (btnView && saved?.id) {
        btnView.href              = `viewer.html?song=${saved.id}`;
        btnView.style.opacity     = '';
        btnView.style.pointerEvents = '';
        btnView.title             = '';
    }

    // Redireciona para o índice após salvar
    window.location.href = 'index.html';
}

/* ════════════════════════════════════════════════════════════════
 * VIEWER
 * ════════════════════════════════════════════════════════════════ */

let viewerState = {
    songs:       [],
    songIdx:     0,
    parsedScore: null,
    cleanXML:    null,
};

async function initViewer() {
    const params    = new URLSearchParams(window.location.search);
    const songId    = params.get('song');
    const setlistId = params.get('setlist');

    if (setlistId) {
        const resolved = getSetlistWithSongs(setlistId);
        if (!resolved?.songs.length) {
            alert('Setlist vazia ou não encontrada.');
            window.location.href = 'index.html';
            return;
        }
        viewerState.songs = resolved.songs;
        initSetlistBar(resolved.songs);
    } else if (songId) {
        const song = getSongById(songId);
        if (!song) {
            alert('Música não encontrada.');
            window.location.href = 'index.html';
            return;
        }
        viewerState.songs = [song];
    } else {
        window.location.href = 'index.html';
        return;
    }

    bindViewerEvents();
    await loadSongInViewer(0);
}

async function loadSongInViewer(songIdx) {
    viewerState.songIdx = songIdx;

    const song      = viewerState.songs[songIdx];
    const contentEl = document.getElementById('viewer-content');

    viewerState.cleanXML = song.musicXML
        ? decodeHTMLEntities(song.musicXML)
        : null;

    setText('viewer-title',  song.title  ?? '');
    setText('viewer-artist', song.artist ?? '');

    const tempoNoteEl = document.getElementById('viewer-tempo-note');
    if (tempoNoteEl) {
        tempoNoteEl.textContent = song.tempo?.note === 'half'   ? '𝅗𝅥'
                                : song.tempo?.note === 'eighth' ? '♪'
                                : song.tempo?.note === 'dotted-quarter' ? '♩.' : '♩';
    }
    setText('viewer-bpm',    song.tempo?.bpm ?? '—');

    const refBtn = document.getElementById('btn-reference');
    if (refBtn) {
        if (song.link) {
            refBtn.style.display = '';
            refBtn.onclick = () => window.open(song.link, '_blank');
        } else {
            refBtn.style.display = 'none';
        }
    }

    updateSetlistBar(songIdx);

    // Adicionado guard para evitar loop se OSMD não carregar
    if (viewerState.cleanXML && !isOSMDReady()) {
        try { await waitForOSMD(); } catch (e) {
            console.warn('OSMD não disponível, continuando sem notação.', e);
            // Não retorna, apenas continua sem a notação musical
        }
    }

    viewerState.parsedScore = null;

    if (viewerState.cleanXML) {
        try {
            viewerState.parsedScore = await parseMusicXML(viewerState.cleanXML);
        } catch (err) {
            console.warn('viewer: erro no parse do MusicXML', err);
        }
    }

    const totalPages = await buildSheet(contentEl, song, viewerState.parsedScore);

    onPageChanged((pageIdx, total) => updatePageControls(pageIdx, total));
    updatePageControls(0, totalPages);
}

/* ── CONTROLES DE PÁGINA ─────────────────────────────────────── */

function bindViewerEvents() {
    const contentEl = document.getElementById('viewer-content');

    document.getElementById('btn-prev')
        ?.addEventListener('click', () => prevPage(contentEl));

    document.getElementById('btn-next')
        ?.addEventListener('click', () => nextPage(contentEl));

    document.getElementById('zone-left')
        ?.addEventListener('click', () => prevPage(contentEl));

    document.getElementById('zone-right')
        ?.addEventListener('click', () => nextPage(contentEl));

    document.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight' || e.key === ' ') {
            e.preventDefault();
            nextPage(contentEl);
        }
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            prevPage(contentEl);
        }
    });

    // ── Botão Voltar sempre vai para o índice ──
    document.getElementById('btn-back')
        ?.addEventListener('click', () => {
            window.location.href = 'index.html';
        });

    // ── Botão de Layout (Colunas) ──
    document.getElementById('btn-layout')
        ?.addEventListener('click', () => {
            const current = localStorage.getItem('holydrums_layout');
            const next = current === 'single' ? 'double' : 'single';
            localStorage.setItem('holydrums_layout', next);
            
            // Recarrega a música atual para aplicar o layout e forçar re-render do OSMD
            loadSongInViewer(viewerState.songIdx);
        });

    // ── Botão Fullscreen ──
    document.getElementById('btn-fullscreen')
        ?.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(err => {
                    console.warn(`Erro ao ativar tela cheia: ${err.message}`);
                });
            } else {
                document.exitFullscreen();
            }
        });

    document.getElementById('btn-prev-song')
        ?.addEventListener('click', () => {
            if (viewerState.songIdx > 0)
                loadSongInViewer(viewerState.songIdx - 1);
        });

    document.getElementById('btn-next-song')
        ?.addEventListener('click', () => {
            if (viewerState.songIdx < viewerState.songs.length - 1)
                loadSongInViewer(viewerState.songIdx + 1);
        });
}

function updatePageControls(pageIdx, total) {
    setText('page-indicator', `${pageIdx + 1} / ${total}`);

    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    if (btnPrev) btnPrev.disabled = pageIdx === 0;
    if (btnNext) btnNext.disabled = pageIdx === total - 1;

    updatePageDots(pageIdx, total);
}

function updatePageDots(pageIdx, total) {
    const container = document.getElementById('page-dots');
    if (!container) return;

    container.innerHTML = '';
    for (let i = 0; i < total; i++) {
        const dot = document.createElement('div');
        dot.className = `page-dot${i === pageIdx ? ' active' : ''}`;
        container.appendChild(dot);
    }
}

/* ── SETLIST BAR ─────────────────────────────────────────────── */

function initSetlistBar(songs) {
    const bar   = document.getElementById('setlist-bar');
    const navEl = document.getElementById('setlist-nav');
    const navElRight = document.getElementById('setlist-nav-right');

    if (bar)   bar.classList.add('visible');
    if (navEl) navEl.style.display = '';
    if (navElRight) navElRight.style.display = '';

    updateSetlistBar(0);
}

function updateSetlistBar(currentIdx) {
    const inner = document.getElementById('setlist-bar-inner');
    if (!inner) return;

    inner.innerHTML = '';
    viewerState.songs.forEach((song, idx) => {
        const pill = document.createElement('button');
        pill.className = `setlist-pill${idx === currentIdx ? ' current' : ''}`;
        pill.innerHTML = `
            <span class="setlist-pill-num">${idx + 1}</span>
            ${escapeHTML(song.title)}`;
        pill.addEventListener('click', () => {
            if (idx !== viewerState.songIdx) loadSongInViewer(idx);
        });
        inner.appendChild(pill);
    });

    const btnPrevSong = document.getElementById('btn-prev-song');
    const btnNextSong = document.getElementById('btn-next-song');

    if (btnPrevSong) {
        btnPrevSong.disabled    = currentIdx === 0;
        btnPrevSong.textContent = currentIdx > 0
            ? `← ${viewerState.songs[currentIdx - 1].title}`
            : '← anterior';
    }

    if (btnNextSong) {
        btnNextSong.disabled    = currentIdx === viewerState.songs.length - 1;
        btnNextSong.textContent = currentIdx < viewerState.songs.length - 1
            ? `${viewerState.songs[currentIdx + 1].title} →`
            : 'próxima →';
    }
}

/* ════════════════════════════════════════════════════════════════
 * UTILITÁRIOS
 * ════════════════════════════════════════════════════════════════ */

function getValue(id) {
    return document.getElementById(id)?.value ?? '';
}

function setValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function escapeHTML(str) {
    return String(str ?? '')
        .replace(/&/g,  '&') // Corrigido para &
        .replace(/</g,  '<')
        .replace(/>/g,  '>')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#39;');
}

function decodeHTMLEntities(str) {
    const el = document.createElement('textarea');
    el.innerHTML = str;
    return el.value;
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}