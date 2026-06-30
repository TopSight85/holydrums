// layout.js — reescrito para paginação instantânea e renderização correta

import { renderAll, destroyInstance } from './renderer.js';

/* ── CONSTANTES DE ESTIMATIVA DE ALTURA ──────────────────────── */

const SAFETY_MARGIN         = 32;
const SECTION_HEADER_HEIGHT = 56;   // padding (24+10) + text (~16) + extra (6)
const NOTATION_MIN_HEIGHT   = 180;  // measure-card min-height (180) + tag + padding + margin (ajustado para 180px)
const LYRIC_LINE_HEIGHT     = 30;   // font-size 0.93rem × line-height 2
const LYRIC_BASE_PADDING    = 30;   // padding vertical do mark + border do lyric-block
const PAIR_MARGIN           = 14;   // margin-bottom dos blocos

/* ── ESTADO ──────────────────────────────────────────────────── */

let currentPages   = [];
let currentPageIdx = 0;
let onPageChange   = null;
let currentScore   = null;
let currentXML     = null;

/* ── ENTRADA PRINCIPAL ───────────────────────────────────────── */

export async function buildSheet(contentEl, song, parsedScore) {
    destroyAll(contentEl);
    currentPages   = [];
    currentPageIdx = 0;
    currentScore   = parsedScore;
    currentXML     = parsedScore?._rawXML ?? null;

    // Cria descritores leves (sem elementos DOM) com alturas estimadas
    const blocks = buildBlockDescriptors(song, parsedScore);

    // Pagina instantaneamente usando alturas estimadas
    const availableHeight = contentEl.clientHeight - SAFETY_MARGIN;
    currentPages = paginate(blocks, availableHeight);

    // Renderiza a primeira página (construindo elementos frescos no DOM)
    await renderPage(contentEl, 0);

    return currentPages.length;
}

/* ── DESCRITORES DE BLOCOS (sem DOM) ─────────────────────────── */

function buildBlockDescriptors(song, parsedScore) {
    const blocks = [];

    song.sections.forEach(section => {
        blocks.push({
            type:            'header',
            name:            section.name,
            estimatedHeight: SECTION_HEADER_HEIGHT,
        });

        section.marks.forEach((mark, markIdx) => {
            const lyricH    = estimateLyricHeight(mark.lyrics);
            const notationH = NOTATION_MIN_HEIGHT;
            const pairH     = Math.max(lyricH, notationH) + PAIR_MARGIN;

            blocks.push({
                type:            'pair',
                mark,
                markIdx,
                estimatedHeight: pairH,
            });
        });
    });

    return blocks;
}

function estimateLyricHeight(lyrics) {
    if (!lyrics) return LYRIC_BASE_PADDING;
    const lineCount = (lyrics.match(/\n/g) || []).length + 1;
    return lineCount * LYRIC_LINE_HEIGHT + LYRIC_BASE_PADDING;
}

/* ── PAGINAÇÃO ───────────────────────────────────────────────── */

function paginate(blocks, availableHeight) {
    if (availableHeight <= 0) availableHeight = 600; // fallback se o container não tiver altura

    const pages = [];
    let currentPageBlocks = [];
    let currentHeight     = 0;

    for (let i = 0; i < blocks.length; i++) {
        const block       = blocks[i];
        const blockHeight = block.estimatedHeight;

        // Evita que um header fique sozinho no final da página
        let nextBlockHeight = 0;
        if (block.type === 'header' && i + 1 < blocks.length) {
            nextBlockHeight = blocks[i + 1].estimatedHeight;
        }

        const wouldOverflow    = currentHeight + blockHeight > availableHeight;
        const headerWouldBeOrphan =
            block.type === 'header' &&
            currentPageBlocks.length > 0 &&
            currentHeight + blockHeight + nextBlockHeight > availableHeight;

        if (wouldOverflow || headerWouldBeOrphan) {
            if (currentPageBlocks.length > 0) {
                pages.push(currentPageBlocks);
            }
            currentPageBlocks = [];
            currentHeight     = 0;
        }

        currentPageBlocks.push(block);
        currentHeight += blockHeight;
    }

    if (currentPageBlocks.length > 0) {
        pages.push(currentPageBlocks);
    }

    return pages.length ? pages : [[]];
}

/* ── RENDERIZAÇÃO DE PÁGINA ──────────────────────────────────── */

async function renderPage(contentEl, pageIdx) {
    // Limpa a página anterior
    contentEl.querySelectorAll('.page').forEach(p => {
        p.querySelectorAll('[data-render-target]').forEach(el => destroyInstance(el));
        p.remove();
    });

    const page   = currentPages[pageIdx];
    const pageEl = document.createElement('div');
    pageEl.className = 'page active';

    const sheet = document.createElement('div');
    sheet.className = 'sheet';

    // Constrói elementos FRESCOS para cada bloco (sem cloneNode)
    page.forEach(block => {
        if (block.type === 'header') {
            sheet.appendChild(buildSectionHeaderEl(block.name));
        } else if (block.type === 'pair') {
            sheet.appendChild(buildLyricEl(block.mark));
            sheet.appendChild(buildNotationEl(block.mark, block.markIdx, currentScore));
        }
    });

    pageEl.appendChild(sheet);
    contentEl.appendChild(pageEl);

    // Força o browser a calcular o layout antes de chamar o OSMD
    // OSMD precisa que o container tenha width real > 0 para renderizar.
    await new Promise(resolve => requestAnimationFrame(resolve));

    // Renderiza notação OSMD nos containers já presentes no DOM
    if (currentScore && currentXML) {
        const renderItems = collectRenderItems(sheet);
        if (renderItems.length) {
            try {
                await renderAll(renderItems, currentXML);
            } catch (err) {
                console.warn('layout: erro ao renderizar notação', err);
            }
        }
    }
}

function collectRenderItems(sheet) {
    const items   = [];
    const targets = sheet.querySelectorAll('[data-render-target]');

    targets.forEach(target => {
        const start = parseInt(target.dataset.measureStart, 10);
        const end   = parseInt(target.dataset.measureEnd,   10);

        if (!start || !currentScore) return;

        const measures = currentScore.measures.filter(
            m => m.number >= start && m.number <= end
        );

        if (measures.length) {
            items.push({ container: target, measures });
        }
    });

    return items;
}

/* ── CONSTRUTORES DE ELEMENTOS DOM ───────────────────────────── */

function buildSectionHeaderEl(name) {
    const el = document.createElement('div');
    el.className = 'section-header';
    el.innerHTML = `
        <span class="section-name">${escapeHTML(name)}</span>
        <div class="section-rule"></div>
    `;
    return el;
}

function buildLyricEl(mark) {
    const el = document.createElement('div');
    el.className = 'lyric-block';

    const markEl = document.createElement('mark');
    markEl.className = mark.groove;
    markEl.innerHTML = escapeHTML(mark.lyrics).replace(/\n/g, '<br>');

    el.appendChild(markEl);
    return el;
}

function buildNotationEl(mark, markIdx, parsedScore) {
    const el = document.createElement('div');
    el.className = 'notation-block';

    const card = document.createElement('div');
    const colorClass = mark.groove === 'nd'
        ? 'nnd'
        : 'n' + mark.groove.replace('g', '');
    card.className      = `measure-card ${colorClass}`.trim();
    card.dataset.markId = mark.id;

    const tag = document.createElement('span');
    tag.className = 'measure-tag';

    const content = document.createElement('div');
    content.className            = 'measure-content';
    content.dataset.renderTarget = 'true';

    if (!parsedScore || !mark.measureStart) {
        content.innerHTML = `
            <span style="color:var(--text-muted);font-size:.78rem;font-style:italic">
                ${mark.groove === 'nd' ? 'Sem bateria' : 'Compasso não definido'}
            </span>`;
        tag.textContent = grooveLabel(mark.groove, markIdx);
        card.appendChild(tag);
        card.appendChild(content);
        el.appendChild(card);
        return el;
    }

    const start    = mark.measureStart;
    const end      = mark.measureEnd ?? mark.measureStart;
    const measures = parsedScore.measures.filter(
        m => m.number >= start && m.number <= end
    );

    if (!measures.length) {
        content.innerHTML = `
            <span style="color:var(--text-muted);font-size:.78rem;font-style:italic">
                Compassos ${start}–${end} não encontrados
            </span>`;
    } else {
        content.dataset.measureStart = start;
        content.dataset.measureEnd   = end;
        // Container vazio — o OSMD renderizará aqui
    }

    tag.textContent = measures.length
        ? `${grooveLabel(mark.groove, markIdx)} · c.${start}${end !== start ? `–${end}` : ''}`
        : grooveLabel(mark.groove, markIdx);

    card.appendChild(tag);
    card.appendChild(content);
    el.appendChild(card);

    return el;
}

/* ── NAVEGAÇÃO ───────────────────────────────────────────────── */

export function goToPage(contentEl, pageIdx) {
    if (pageIdx < 0 || pageIdx >= currentPages.length) return;
    currentPageIdx = pageIdx;
    renderPage(contentEl, pageIdx);
    onPageChange?.(pageIdx, currentPages.length);
}

export function nextPage(contentEl) {
    goToPage(contentEl, currentPageIdx + 1);
}

export function prevPage(contentEl) {
    goToPage(contentEl, currentPageIdx - 1);
}

export function getCurrentPageIdx() { return currentPageIdx; }
export function getTotalPages()     { return currentPages.length; }

export function onPageChanged(callback) {
    onPageChange = callback;
}

/* ── LIMPEZA ─────────────────────────────────────────────────── */

function destroyAll(contentEl) {
    contentEl.querySelectorAll('[data-render-target]').forEach(el => {
        destroyInstance(el);
    });
    contentEl.querySelectorAll('.page').forEach(p => p.remove());
}

/* ── UTILITÁRIOS ─────────────────────────────────────────────── */

function grooveLabel(groove, idx) {
    if (groove === 'nd') return 'Sem bateria';
    const letters = ['A','B','C','D','E','F'];
    const num     = parseInt(groove.replace('g', ''), 10);
    return `Groove ${letters[num - 1] ?? idx + 1}`;
}

function escapeHTML(str) {
    return String(str ?? '')
        .replace(/&/g,  '&')
        .replace(/</g,  '<')
        .replace(/>/g,  '>')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#39;');
}