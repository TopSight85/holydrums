// layout.js — todas as páginas de uma música são renderizadas de uma vez
// (escondidas), então trocar de página é só alternar uma classe CSS.
// As músicas ficam em cache para poderem ser pré-carregadas em segundo plano.

import { renderAll, destroyInstance } from './renderer.js';

/* ── CONSTANTES DE ESTIMATIVA DE ALTURA ──────────────────────────
 * Cabeçalho de seção e letra são medidos de verdade no DOM a cada
 * preparação (ver measureBlocks). A notação (measure-card) não dá pra
 * medir antes do OSMD renderizar, então usamos a altura mínima do CSS
 * mais uma folga heurística; se mesmo assim estourar, a autocorreção
 * move blocos para a página seguinte.
 * ──────────────────────────────────────────────────────────────── */

const SAFETY_MARGIN = 32;
const PAIR_MARGIN = 14;

const NOTATION_BASE_HEIGHT = 120;
const WRAP_RISK_PER_EXTRA_MEASURE = 20;
const WRAP_RISK_MAX = 100;

const HEADER_FALLBACK_HEIGHT = 44;
const LYRIC_FALLBACK_HEIGHT = 30;

const OVERFLOW_THRESHOLD = 8;
const MAX_CORRECTION_PASSES = 8;

/* ── ESTADO ──────────────────────────────────────────────────── */

const sheets = new Map();   // chave -> sheet (músicas já renderizadas ou em renderização)
let activeSheet = null;
let onPageChange = null;

function sheetKey(song) {
    const layout = localStorage.getItem('holydrums_layout') === 'single' ? 'single' : 'double';
    return `${song.id}:${song.updatedAt ?? 0}:${layout}`;
}

/* ── PREPARAR (renderiza TUDO, sem mostrar) ──────────────────── */

/**
 * Renderiza todas as páginas da música em segundo plano.
 * Se já estiver em cache (ou em andamento), devolve a mesma Promise.
 */
export function prepareSheet(contentEl, song, parsedScore, onProgress = null) {
    const key = sheetKey(song);
    const cached = sheets.get(key);
    if (cached) return cached.ready;

    const sheet = {
        key,
        root: null,
        pages: [],      // descritores de blocos por página
        pageEls: [],    // elementos DOM já renderizados
        pageIdx: 0,
        score: parsedScore,
        xml: parsedScore?._rawXML ?? null,
        dead: false,
        ready: null,
        onProgress,
    };
    sheets.set(key, sheet);

    sheet.ready = buildSheetInstance(contentEl, song, sheet).catch(err => {
        sheets.delete(key);
        sheet.root?.remove();
        throw err;
    });

    return sheet.ready;
}

async function buildSheetInstance(contentEl, song, sheet) {
    const measured = measureBlocks(contentEl, song, sheet.score);
    const blocks = buildBlockDescriptors(song, sheet.score, measured);
    sheet.pages = paginate(blocks, contentEl.clientHeight - SAFETY_MARGIN);

    sheet.root = document.createElement('div');
    sheet.root.className = 'sheet-root';
    contentEl.appendChild(sheet.root);

    // sheet.pages.length pode crescer durante o loop (autocorreção de overflow)
    for (let i = 0; i < sheet.pages.length; i++) {
        if (sheet.dead) return sheet;
        await renderPageInto(sheet, i);
        sheet.onProgress?.(i + 1, sheet.pages.length);
    }

    return sheet;
}

async function renderPageInto(sheet, pageIdx, correctionDepth = 0) {
    const old = sheet.pageEls[pageIdx];
    if (old) {
        old.querySelectorAll('[data-render-target]').forEach(el => destroyInstance(el));
        old.remove();
    }

    const pageEl = document.createElement('div');
    pageEl.className = 'page';

    const sheetEl = document.createElement('div');
    sheetEl.className = 'sheet';
    if (localStorage.getItem('holydrums_layout') === 'single') {
        sheetEl.classList.add('sheet-single-col');
    }

    sheet.pages[pageIdx].forEach(block => {
        if (block.type === 'header') {
            sheetEl.appendChild(buildSectionHeaderEl(block.name));
        } else if (block.type === 'pair') {
            sheetEl.appendChild(buildLyricEl(block.mark));
            sheetEl.appendChild(buildNotationEl(block.mark, block.markIdx, sheet.score));
        }
    });

    pageEl.appendChild(sheetEl);
    sheet.root.appendChild(pageEl);
    sheet.pageEls[pageIdx] = pageEl;

    // O OSMD precisa de largura real. A página está "visibility:hidden"
    // (e não display:none), então o layout existe e a medida é correta.
    await settleLayout();
    if (sheet.dead) return;

    if (sheet.score && sheet.xml) {
        const items = collectRenderItems(sheetEl, sheet.score);
        if (items.length) {
            try {
                await renderAll(items, sheet.xml);
            } catch (err) {
                console.warn('layout: erro ao renderizar notação', err);
            }
        }
    }
    if (sheet.dead) return;

    // Autocorreção: se a página real ficou maior que o espaço disponível,
    // devolve o último bloco para a próxima página e renderiza de novo.
    const overflow = sheetEl.scrollHeight - pageEl.clientHeight;
    if (overflow > OVERFLOW_THRESHOLD) {
        if (correctionDepth < MAX_CORRECTION_PASSES && pushOverflowToNextPage(sheet, pageIdx)) {
            await renderPageInto(sheet, pageIdx, correctionDepth + 1);
            return;
        }
        console.warn(
            `layout: página ${pageIdx + 1} ficou ${Math.round(overflow)}px maior que o espaço disponível ` +
            `mesmo após autocorreção.`
        );
    }
}

function pushOverflowToNextPage(sheet, pageIdx) {
    const page = sheet.pages[pageIdx];
    if (!page || page.length <= 1) return false;

    const moved = [page.pop()];

    // Não deixa um cabeçalho de seção sozinho no fim da página
    while (page.length > 0 && page[page.length - 1].type === 'header') {
        moved.unshift(page.pop());
    }

    if (!page.length) {
        page.push(...moved);
        return false;
    }

    if (!sheet.pages[pageIdx + 1]) sheet.pages[pageIdx + 1] = [];
    sheet.pages[pageIdx + 1].unshift(...moved);
    return true;
}

function collectRenderItems(sheetEl, score) {
    const items = [];
    sheetEl.querySelectorAll('[data-render-target]').forEach(target => {
        const start = parseInt(target.dataset.measureStart, 10);
        const end = parseInt(target.dataset.measureEnd, 10);
        if (!start || !score) return;

        const measures = score.measures.filter(m => m.number >= start && m.number <= end);
        if (measures.length) items.push({ container: target, measures });
    });
    return items;
}

/* ── MOSTRAR / NAVEGAR (instantâneo: só troca de classe) ─────── */

export function showSheet(contentEl, sheet) {
    if (!sheet || sheet.dead || !sheet.root) return 0;

    contentEl.querySelectorAll('.sheet-root.active')
        .forEach(r => r.classList.remove('active'));

    sheet.root.classList.add('active');
    activeSheet = sheet;
    setActivePage(sheet, 0);
    return sheet.pages.length;
}

function setActivePage(sheet, pageIdx) {
    sheet.pageIdx = pageIdx;
    sheet.pageEls.forEach((el, i) => el.classList.toggle('active', i === pageIdx));
    sheet.pageEls[pageIdx]?.scrollTo(0, 0);
    onPageChange?.(pageIdx, sheet.pages.length);
}

export function goToPage(_contentEl, pageIdx) {
    if (!activeSheet) return;
    if (pageIdx < 0 || pageIdx >= activeSheet.pageEls.length) return;
    setActivePage(activeSheet, pageIdx);
}

export function nextPage(contentEl) {
    goToPage(contentEl, (activeSheet?.pageIdx ?? 0) + 1);
}

export function prevPage(contentEl) {
    goToPage(contentEl, (activeSheet?.pageIdx ?? 0) - 1);
}

export function getCurrentPageIdx() { return activeSheet?.pageIdx ?? 0; }
export function getTotalPages() { return activeSheet?.pages.length ?? 0; }

export function onPageChanged(callback) {
    onPageChange = callback;
}

/* ── LIMPEZA ─────────────────────────────────────────────────── */

export function clearSheets(contentEl) {
    sheets.forEach(sheet => {
        sheet.dead = true;
        sheet.root?.querySelectorAll('[data-render-target]').forEach(el => destroyInstance(el));
        sheet.root?.remove();
    });
    sheets.clear();
    activeSheet = null;
    contentEl?.querySelectorAll('.sheet-root').forEach(r => r.remove());
}

/* ── MEDIÇÃO REAL NO DOM (cabeçalho, letra, notação sem OSMD) ──── */

function measureBlocks(contentEl, song, parsedScore) {
    const probeWrap = document.createElement('div');
    probeWrap.style.position = 'absolute';
    probeWrap.style.visibility = 'hidden';
    probeWrap.style.pointerEvents = 'none';
    probeWrap.style.left = '-9999px';
    probeWrap.style.top = '0';
    probeWrap.style.width = Math.max(contentEl.clientWidth, 1) + 'px';

    const isSingleCol = localStorage.getItem('holydrums_layout') === 'single';
    const probeSheet = document.createElement('div');
    probeSheet.className = 'sheet' + (isSingleCol ? ' sheet-single-col' : '');

    probeWrap.appendChild(probeSheet);
    document.body.appendChild(probeWrap);

    const headerProbe = buildSectionHeaderEl('Sonda de medição');
    probeSheet.appendChild(headerProbe);
    const headerHeight = headerProbe.offsetHeight || HEADER_FALLBACK_HEIGHT;
    probeSheet.removeChild(headerProbe);

    const lyricHeights = new Map();
    const notationHeights = new Map();

    song.sections.forEach(section => {
        section.marks.forEach((mark, markIdx) => {
            const lyricProbe = buildLyricEl(mark);
            probeSheet.appendChild(lyricProbe);
            lyricHeights.set(mark.id, lyricProbe.offsetHeight || LYRIC_FALLBACK_HEIGHT);
            probeSheet.removeChild(lyricProbe);

            if (!hasRenderableNotation(mark, parsedScore)) {
                const notationProbe = buildNotationEl(mark, markIdx, parsedScore);
                if (!isSingleCol) notationProbe.style.gridColumn = '2';
                probeSheet.appendChild(notationProbe);
                notationHeights.set(mark.id, notationProbe.offsetHeight);
                probeSheet.removeChild(notationProbe);
            }
        });
    });

    document.body.removeChild(probeWrap);
    return { headerHeight, lyricHeights, notationHeights };
}

function hasRenderableNotation(mark, parsedScore) {
    if (!parsedScore || !mark.measureStart) return false;
    const start = mark.measureStart;
    const end = mark.measureEnd ?? mark.measureStart;
    return parsedScore.measures.some(m => m.number >= start && m.number <= end);
}

/* ── DESCRITORES DE BLOCOS (sem DOM) ─────────────────────────── */

function buildBlockDescriptors(song, parsedScore, measured) {
    const blocks = [];

    song.sections.forEach(section => {
        blocks.push({
            type: 'header',
            name: section.name,
            estimatedHeight: measured.headerHeight,
        });

        section.marks.forEach((mark, markIdx) => {
            const lyricH = measured.lyricHeights.get(mark.id) ?? LYRIC_FALLBACK_HEIGHT;
            const notationH = estimateNotationHeight(mark, parsedScore, measured);
            const pairH = Math.max(lyricH, notationH) + PAIR_MARGIN;

            blocks.push({
                type: 'pair',
                mark,
                markIdx,
                estimatedHeight: pairH,
            });
        });
    });

    return blocks;
}

function estimateNotationHeight(mark, parsedScore, measured) {
    if (!hasRenderableNotation(mark, parsedScore)) {
        return measured.notationHeights.get(mark.id) ?? NOTATION_BASE_HEIGHT;
    }

    const start = mark.measureStart;
    const end = mark.measureEnd ?? mark.measureStart;
    const measureCount = Math.max(1, end - start + 1);
    const wrapRisk = Math.min(WRAP_RISK_MAX, (measureCount - 1) * WRAP_RISK_PER_EXTRA_MEASURE);

    return NOTATION_BASE_HEIGHT + wrapRisk;
}

/* ── PAGINAÇÃO ───────────────────────────────────────────────── */

function paginate(blocks, availableHeight) {
    if (availableHeight <= 0) availableHeight = 600;

    const pages = [];
    let currentPageBlocks = [];
    let currentHeight = 0;

    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const blockHeight = block.estimatedHeight;

        let nextBlockHeight = 0;
        if (block.type === 'header' && i + 1 < blocks.length) {
            nextBlockHeight = blocks[i + 1].estimatedHeight;
        }

        const wouldOverflow = currentHeight + blockHeight > availableHeight;
        const headerWouldBeOrphan =
            block.type === 'header' &&
            currentPageBlocks.length > 0 &&
            currentHeight + blockHeight + nextBlockHeight > availableHeight;

        if (wouldOverflow || headerWouldBeOrphan) {
            if (currentPageBlocks.length > 0) {
                pages.push(currentPageBlocks);
            }
            currentPageBlocks = [];
            currentHeight = 0;
        }

        currentPageBlocks.push(block);
        currentHeight += blockHeight;
    }

    if (currentPageBlocks.length > 0) {
        pages.push(currentPageBlocks);
    }

    return pages.length ? pages : [[]];
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

    let html = escapeHTML(mark.lyrics).replace(/\n/g, '<br>');
    // Converte textos entre colchetes [assim] para a fonte manuscrita vermelha
    html = html.replace(/\[(.*?)\]/g, '<span class="ann">$1</span>');

    markEl.innerHTML = html;

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
    card.className = `measure-card ${colorClass}`.trim();
    card.dataset.markId = mark.id;

    const tag = document.createElement('span');
    tag.className = 'measure-tag';

    const content = document.createElement('div');
    content.className = 'measure-content';
    content.dataset.renderTarget = 'true';

    if (!parsedScore || !mark.measureStart) {
        content.innerHTML = `
            <span class="measure-msg">
                ${mark.groove === 'nd' ? '-' : 'Compasso não definido'}
            </span>`;
        tag.textContent = grooveLabel(mark.groove, markIdx);
        card.appendChild(tag);
        card.appendChild(content);
        el.appendChild(card);
        return el;
    }

    const start = mark.measureStart;
    const end = mark.measureEnd ?? mark.measureStart;
    const measures = parsedScore.measures.filter(
        m => m.number >= start && m.number <= end
    );

    if (!measures.length) {
        content.innerHTML = `
            <span class="measure-msg">
                Compassos ${start}–${end} não encontrados
            </span>`;
    } else {
        content.dataset.measureStart = start;
        content.dataset.measureEnd = end;
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

/* ── UTILITÁRIOS ─────────────────────────────────────────────── */

/** Garante que o layout (largura real do container) já assentou antes de medir. */
async function settleLayout() {
    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => requestAnimationFrame(resolve));
    if (document.fonts?.ready) {
        try { await document.fonts.ready; } catch { /* noop */ }
    }
}

function grooveLabel(groove, idx) {
    if (groove === 'nd') return 'Sem bateria';
    const letters = ['A','B','C','D','E','F','G','H','I','J','K','L'];
    const num = parseInt(groove.replace('g', ''), 10);
    return `Groove ${letters[num - 1] ?? idx + 1}`;
}

function escapeHTML(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}