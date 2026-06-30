// app.js

import { initDrive, connectDrive, saveBackupToDrive, loadBackupFromDrive } from './drive.js';

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
import { waitForOSMD, isOSMDReady }         from './renderer.js';
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

    // Garante estado inicial dos botões Drive (desconectado)
    updateDriveUI(false);
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
        btnSave.classList.toggle('btn-drive-active', connected);
    }
    if (btnLoad) {
        btnLoad.disabled = !connected;
        btnLoad.classList.toggle('btn-drive-active', connected);
    }
}

async function handleDriveConnect() {
    if (driveConnected) {
        // Desconectar
        updateDriveUI(false);
        return;
    }
    try {
        await connectDrive();
        updateDriveUI(true);
    } catch (err) {
        alert(`Falha ao conectar no Drive: ${err.message}`);
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

    card.addEventListener('click', e => {
        if (e.target.closest('[data-action]')) return;
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

    const allSongs   = getAllSongs().sort((a, b) => a.title.localeCompare(b.title));
    const currentIds = resolved.songIds;

    const options = allSongs.map((s, i) =>
        `${i + 1}. [${currentIds.includes(s.id) ? 'X' : ' '}] ${s.title}`
    ).join('\n');

    const input = prompt(
        `Setlist: ${resolved.name}\n\n` +
        `Digite os números das músicas separados por vírgula\n` +
        `(na ordem em que devem tocar):\n\n${options}`
    );

    if (input === null) return;

    const indices  = input.split(',').map(n => parseInt(n.trim(), 10) - 1);
    const selected = indices
        .filter(i => i >= 0 && i < allSongs.length)
        .map(i => allSongs[i].id);

    reorderSetlist(setlistId, selected);
    renderSetlistList();
}

/* ════════════════════════════════════════════════════════════════
 * EDITOR
 * ════════════════════════════════════════════════════════════════ */

let editorState = {
    song:     null,
    musicXML: null,
    sections: [],
};

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
    editorState.song     = song;
    editorState.musicXML = song.musicXML
        ? decodeHTMLEntities(song.musicXML)
        : null;
    editorState.sections = structuredClone(song.sections ?? []);

    setValue('song-title',  song.title  ?? '');
    setValue('song-artist', song.artist ?? '');
    setValue('song-link',   song.link   ?? '');
    setValue('tempo-bpm',   song.tempo?.bpm  ?? 80);
    setValue('tempo-note',  song.tempo?.note ?? 'quarter');

    if (song.musicXML) showFilename(song.title + '.xml');

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
        editorState.musicXML = text;
        showFilename(file.name);
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

/* ── SEÇÕES ──────────────────────────────────────────────────── */

function renderSections() {
    const container = document.getElementById('sections-list');
    if (!container) return;

    container.innerHTML = '';
    editorState.sections.forEach((section, sIdx) => {
        container.appendChild(buildSectionItem(section, sIdx));
    });
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
    const GROOVES = ['nd','g1','g2','g3','g4','g5','g6'];

    const item = document.createElement('div');
    item.className     = 'mark-item';
    item.dataset.sIdx  = sIdx; // Índice da seção pai
    item.dataset.mIdx  = mIdx; // Índice do mark
    item.draggable     = true; // Habilita drag para o trecho
    item.style.cssText = 'grid-template-columns: 24px 1fr auto auto auto; gap: 8px;';

    // ── Botão de cor/groove ──
    const colorBtn = document.createElement('button');
    colorBtn.className = `mark-color-btn ${mark.groove}`;
    colorBtn.title     = 'Clique para trocar o groove';

    colorBtn.addEventListener('click', () => {
        const idx  = GROOVES.indexOf(mark.groove);
        const next = GROOVES[(idx + 1) % GROOVES.length];
        editorState.sections[sIdx].marks[mIdx].groove = next;
        colorBtn.className = `mark-color-btn ${next}`;
    });

    // ── Textarea de letra ──
    const textarea = document.createElement('textarea');
    textarea.className   = 'mark-textarea';
    textarea.placeholder = 'Cole a letra deste trecho aqui…';
    textarea.value       = mark.lyrics ?? '';

    textarea.addEventListener('input', e => {
        editorState.sections[sIdx].marks[mIdx].lyrics = e.target.value;
    });

    // ── Inputs de compasso ──
    const measureWrap = document.createElement('div');
    measureWrap.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 4px;
        align-items: center;
        justify-content: center;
        padding-top: 8px;
    `;

    const inputStyle = `
        width: 56px;
        font-family: inherit;
        font-size: 0.78rem;
        text-align: center;
        background: var(--bg);
        border: 1.5px solid var(--border);
        border-radius: 6px;
        padding: 4px 6px;
        outline: none;
        color: var(--text-primary);
    `;

    const measureStart = document.createElement('input');
    measureStart.type          = 'number';
    measureStart.min           = '1';
    measureStart.placeholder   = 'C.ini';
    measureStart.title         = 'Compasso inicial';
    measureStart.value         = mark.measureStart ?? '';
    measureStart.style.cssText = inputStyle;

    const measureEnd = document.createElement('input');
    measureEnd.type          = 'number';
    measureEnd.min           = '1';
    measureEnd.placeholder   = 'C.fim';
    measureEnd.title         = 'Compasso final';
    measureEnd.value         = mark.measureEnd ?? '';
    measureEnd.style.cssText = inputStyle;

    const measureLabel = document.createElement('span');
    measureLabel.textContent   = '↕';
    measureLabel.style.cssText = 'font-size: 0.65rem; color: var(--text-muted);';

    measureStart.addEventListener('input', e => {
        editorState.sections[sIdx].marks[mIdx].measureStart =
            parseInt(e.target.value, 10) || null;
    });

    measureEnd.addEventListener('input', e => {
        editorState.sections[sIdx].marks[mIdx].measureEnd =
            parseInt(e.target.value, 10) || null;
    });

    measureWrap.appendChild(measureStart);
    measureWrap.appendChild(measureLabel);
    measureWrap.appendChild(measureEnd);

    // ── Botão duplicar trecho ──
    const dupMarkBtn = document.createElement('button');
    dupMarkBtn.className     = 'icon-btn';
    dupMarkBtn.title         = 'Duplicar trecho';
    dupMarkBtn.style.cssText = 'align-self: start; margin-top: 9px;';
    dupMarkBtn.innerHTML     = `
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
    removeBtn.className     = 'icon-btn danger';
    removeBtn.title         = 'Remover trecho';
    removeBtn.style.cssText = 'align-self: start; margin-top: 9px;';
    removeBtn.innerHTML     = `
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

    item.appendChild(colorBtn);
    item.appendChild(textarea);
    item.appendChild(measureWrap);
    item.appendChild(dupMarkBtn); // Adicionado o botão de duplicar trecho
    item.appendChild(removeBtn);

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

    sectionsList.addEventListener('dragover', e => {
        e.preventDefault();
        if (!draggedItem) return;

        const target = e.target.closest('.section-item, .mark-item');
        if (!target || target === draggedItem.el) return;

        const bounding = target.getBoundingClientRect();
        const offset   = bounding.y + (bounding.height / 2);

        if (draggedItem.type === 'section' && target.classList.contains('section-item')) {
            if (e.clientY - offset > 0) {
                target.after(draggedItem.el);
            } else {
                target.before(draggedItem.el);
            }
        } else if (draggedItem.type === 'mark' && target.classList.contains('mark-item')) {
            // Apenas permite reordenar marks dentro da mesma seção
            if (draggedItem.sIdx === parseInt(target.dataset.sIdx, 10)) {
                if (e.clientY - offset > 0) {
                    target.after(draggedItem.el);
                } else {
                    target.before(draggedItem.el);
                }
            }
        }
    });

    sectionsList.addEventListener('dragend', e => {
        if (draggedItem) {
            draggedItem.el.classList.remove('dragging');
            draggedItem = null;
            updateOrder();
        }
    });

    // Adiciona dragover para as listas de marks para permitir soltar em listas vazias
    sectionsList.addEventListener('dragover', e => {
        e.preventDefault();
        if (!draggedItem || draggedItem.type !== 'mark') return;

        const targetList = e.target.closest('.marks-list');
        if (targetList && targetList.children.length === 0) {
            // Se a lista de marks estiver vazia, permite soltar
            targetList.appendChild(draggedItem.el);
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
                                : song.tempo?.note === 'eighth' ? '♪' : '♩';
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