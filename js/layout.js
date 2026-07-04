// layout.js — reescrito para paginação instantânea e renderização correta

import { renderAll, destroyInstance } from './renderer.js';

/* ── CONSTANTES DE ESTIMATIVA DE ALTURA ──────────────────────────
 * Cabeçalho de seção e letra são medidos de verdade no DOM a cada
 * buildSheet() (ver measureBlocks) — não usam mais número fixo, então
 * nunca mais desalinham do CSS. A notação (measure-card) não dá pra
 * medir de verdade quando o OSMD vai renderizar (isso só se sabe depois
 * de renderizar, e é justamente o que queremos evitar fazer antes de
 * paginar) — pra esses casos usamos a altura mínima real do CSS mais
 * uma folga heurística por risco de quebra de linha em grooves com
 * vários compassos. Quando NÃO há OSMD envolvido (ND / compasso não
 * definido / compasso não encontrado), o conteúdo é só texto e CSS,
 * então também é medido de verdade.
 * ──────────────────────────────────────────────────────────────── */

const SAFETY_MARGIN = 32;
const PAIR_MARGIN = 14;   // margin-bottom dos blocos (lyric-block / notation-block)

const NOTATION_BASE_HEIGHT = 120;          // bate com .measure-card { min-height: 120px }
const WRAP_RISK_PER_EXTRA_MEASURE = 20;    // heurística: chance de o OSMD quebrar em 2 linhas de pauta
const WRAP_RISK_MAX = 100;                 // teto da folga, pra não voltar a desperdiçar espaço

const HEADER_FALLBACK_HEIGHT = 44;
const LYRIC_FALLBACK_HEIGHT = 30;

const OVERFLOW_THRESHOLD = 8;      // mesma tolerância que já existia no aviso de overflow
const MAX_CORRECTION_PASSES = 8;   // trava de segurança contra loop de autocorreção

/* ── ESTADO ──────────────────────────────────────────────────── */

let currentPages = [];
let currentPageIdx = 0;
let onPageChange = null;
let currentScore = null;
let currentXML = null;

/* ── ENTRADA PRINCIPAL ───────────────────────────────────────── */

export async function buildSheet(contentEl, song, parsedScore) {
    destroyAll(contentEl);
    currentPages = [];
    currentPageIdx = 0;
    currentScore = parsedScore;
    currentXML = parsedScore?._rawXML ?? null;

    // Mede no DOM (escondido) as alturas reais de cabeçalho/letra, e dos
    // cards de notação que não dependem do OSMD (ND / sem compasso).
    const measured = measureBlocks(contentEl, song, parsedScore);

    // Cria descritores leves (sem elementos DOM) com as alturas medidas/estimadas
    const blocks = buildBlockDescriptors(song, parsedScore, measured);

    // Pagina instantaneamente usando essas alturas
    const availableHeight = contentEl.clientHeight - SAFETY_MARGIN;
    currentPages = paginate(blocks, availableHeight);

    // Renderiza a primeira página (construindo elementos frescos no DOM)
    await renderPage(contentEl, 0);

    return currentPages.length;
}

/* ── MEDIÇÃO REAL NO DOM (cabeçalho, letra, notação sem OSMD) ──── */

/**
 * Cria uma cópia invisível do grid do "sheet" (mesma largura e mesmo
 * modo de coluna do render real) e mede a altura que cada bloco
 * realmente ocupa com o CSS atual — em vez de confiar em números
 * fixos que ficam desatualizados quando o CSS muda.
 */
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

    // Cabeçalho de seção — altura representativa (mesma pra todas as seções;
    // nomes muito longos que quebrem em 2 linhas não são considerados)
    const headerProbe = buildSectionHeaderEl('Sonda de medição');
    probeSheet.appendChild(headerProbe);
    const headerHeight = headerProbe.offsetHeight || HEADER_FALLBACK_HEIGHT;
    probeSheet.removeChild(headerProbe);

    const lyricHeights = new Map();
    const notationHeights = new Map();

    song.sections.forEach(section => {
        section.marks.forEach((mark, markIdx) => {
            // Letra: mede o conteúdo real (respeita \n E quebra automática
            // de linha por texto longo, que o cálculo antigo ignorava)
            const lyricProbe = buildLyricEl(mark);
            probeSheet.appendChild(lyricProbe);
            lyricHeights.set(mark.id, lyricProbe.offsetHeight || LYRIC_FALLBACK_HEIGHT);
            probeSheet.removeChild(lyricProbe);

            // Notação: só dá pra medir de verdade quando NÃO depende do OSMD
            // (ND, compasso não definido/não encontrado) — esses casos são
            // só texto e CSS, então a medição já sai exata.
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

/**
 * true quando o trecho realmente vai ter uma notação renderizada pelo OSMD
 * — precisa espelhar exatamente a condição usada em buildNotationEl() pra
 * não subestimar a altura de trechos antigos que ainda tenham measureStart
 * salvo de antes do groove ND passar a limpar esses campos.
 */
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

/**
 * Altura da notação. Quando o OSMD vai renderizar de verdade, não dá pra
 * medir com antecedência — usamos a altura mínima real do CSS (120px) mais
 * uma folga que cresce com o número de compassos do trecho, já que grooves
 * com vários compassos têm mais chance do OSMD quebrar em 2 linhas de pauta
 * (isso depende da densidade de notas, então é uma heurística, não garantia).
 */
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
    if (availableHeight <= 0) availableHeight = 600; // fallback se o container não tiver altura

    const pages = [];
    let currentPageBlocks = [];
    let currentHeight = 0;

    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const blockHeight = block.estimatedHeight;

        // Evita que um header fique sozinho no final da página
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

/* ── RENDERIZAÇÃO DE PÁGINA ──────────────────────────────────── */

async function renderPage(contentEl, pageIdx, correctionDepth = 0) {
    // Limpa a página anterior
    contentEl.querySelectorAll('.page').forEach(p => {
        p.querySelectorAll('[data-render-target]').forEach(el => destroyInstance(el));
        p.remove();
    });

    const page = currentPages[pageIdx];
    const pageEl = document.createElement('div');
    pageEl.className = 'page active';

    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    if (localStorage.getItem('holydrums_layout') === 'single') {
        sheet.classList.add('sheet-single-col');
    }

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

    // Força o browser a "assentar" o layout antes de chamar o OSMD.
    // Um único rAF não é suficiente após uma troca de layout (grid-template-columns
    // muda a largura do container e as fontes do Google Fonts podem reajustar
    // métricas em seguida) — por isso aguardamos dois frames + as fontes prontas,
    // garantindo que o OSMD meça a largura final, não uma intermediária.
    await settleLayout();

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

    // Autocorreção: se a página real ficar maior que o espaço disponível
    // (a heurística de notação subestimou o quanto o OSMD ia quebrar em
    // linhas), devolve o(s) último(s) bloco(s) pra próxima página e
    // re-renderiza esta já corrigida — em vez de só logar e deixar cortado.
    const overflow = sheet.scrollHeight - contentEl.clientHeight;
    if (overflow > OVERFLOW_THRESHOLD) {
        if (correctionDepth < MAX_CORRECTION_PASSES && pushOverflowToNextPage(pageIdx)) {
            await renderPage(contentEl, pageIdx, correctionDepth + 1);
            return;
        }

        // Não deu pra corrigir sozinho (sobrou 1 bloco só e mesmo assim não
        // cabe, ou esgotou as tentativas) — aí sim só avisa no console.
        console.warn(
            `layout: página ${pageIdx + 1} ficou ${Math.round(overflow)}px maior que o espaço disponível ` +
            `mesmo após autocorreção (estimativa de altura ficou muito abaixo do real nesta página).`
        );
    }
}

/**
 * Move o(s) último(s) bloco(s) da página `pageIdx` para o início da próxima
 * página, como resposta a um overflow real medido depois do render do OSMD.
 * Também evita deixar um cabeçalho de seção sozinho, sem nenhum trecho
 * abaixo, no fim da página — mesma regra que a paginação inicial já respeita
 * (ver headerWouldBeOrphan em paginate()).
 *
 * Só mexe na página atual e na seguinte; páginas já visitadas antes não são
 * alteradas retroativamente. Se a próxima página ainda não existir (esta é
 * a última), ela é criada — o que aumenta o total de páginas da música.
 */
function pushOverflowToNextPage(pageIdx) {
    const page = currentPages[pageIdx];
    if (!page || page.length <= 1) return false;

    const moved = [page.pop()];

    while (page.length > 0 && page[page.length - 1].type === 'header') {
        moved.unshift(page.pop());
    }

    if (!page.length) {
        // Não sobrou nada além do(s) cabeçalho(s) — desfaz e desiste;
        // não há como encolher mais esta página.
        page.push(...moved);
        return false;
    }

    if (!currentPages[pageIdx + 1]) currentPages[pageIdx + 1] = [];
    currentPages[pageIdx + 1].unshift(...moved);

    return true;
}

/** Garante que o layout (largura real do container) já assentou antes de medir. */
async function settleLayout() {
    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => requestAnimationFrame(resolve));
    if (document.fonts?.ready) {
        try { await document.fonts.ready; } catch { /* noop */ }
    }
}

function collectRenderItems(sheet) {
    const items = [];
    const targets = sheet.querySelectorAll('[data-render-target]');

    targets.forEach(target => {
        const start = parseInt(target.dataset.measureStart, 10);
        const end = parseInt(target.dataset.measureEnd, 10);

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

/* ── NAVEGAÇÃO ───────────────────────────────────────────────── */

export async function goToPage(contentEl, pageIdx) {
    if (pageIdx < 0 || pageIdx >= currentPages.length) return;
    currentPageIdx = pageIdx;
    // Aguarda o render (que pode incluir passes de autocorreção e por isso
    // mudar currentPages.length) antes de avisar a UI do total de páginas.
    await renderPage(contentEl, pageIdx);
    onPageChange?.(pageIdx, currentPages.length);
}

export function nextPage(contentEl) {
    goToPage(contentEl, currentPageIdx + 1);
}

export function prevPage(contentEl) {
    goToPage(contentEl, currentPageIdx - 1);
}

export function getCurrentPageIdx() { return currentPageIdx; }
export function getTotalPages() { return currentPages.length; }

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
    const letters = ['A','B','C','D','E','F','G','H','I','J','K','L'];
    const num = parseInt(groove.replace('g', ''), 10);
    return `Groove ${letters[num - 1] ?? idx + 1}`;
}

function escapeHTML(str) {
    return String(str ?? '')
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
