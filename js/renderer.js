// renderer.js

function getOSMD() {
    return window.opensheetmusicdisplay ?? null;
}

const DEFAULT_OPTIONS = {
    autoResize: false,
    backend: 'svg',
    drawTitle: false,
    drawComposer: false,
    drawCredits: false,
    drawPartNames: false,
    drawPartAbbreviations: false,
    drawMeasureNumbers: false,
    drawTimeSignatures: true,
    drawKeySignatures: false,
    drawDefaultClefAtBegin: false,
    followCursor: false,
    setWantedNumberOfMeasuresPerRow: 1,
};

const instances = new WeakMap();

/* ── API ─────────────────────────────────────────────────────── */

export async function renderMeasure(container, measure, xmlString, options = {}) {
    const OSMD = getOSMD();
    if (!OSMD) return renderFallback(container, measure);

    destroyInstance(container);

    let xml;
    try {
        xml = extractMeasureRange(xmlString, measure.number, measure.number);
    } catch (err) {
        console.warn(`renderer: falha ao extrair compasso ${measure.number}`, err);
        return renderFallback(container, measure);
    }

    const osmd = new OSMD.OpenSheetMusicDisplay(container, {
        ...DEFAULT_OPTIONS,
        ...options,
    });

    enableGhostNoteParentheses(osmd);

    try {
        await osmd.load(xml);
        osmd.render();
        hideClefsInSVG(container);
        instances.set(container, osmd);
        scaleSVG(container);
    } catch (err) {
        console.warn(`renderer: falha ao renderizar compasso ${measure.number}`, err);
        renderFallback(container, measure);
    }
}

export async function renderMeasures(container, measures, xmlString, options = {}) {
    if (!measures?.length) return;

    const OSMD = getOSMD();
    if (!OSMD) {
        container.innerHTML = '';
        measures.forEach(m => renderFallback(container, m));
        return;
    }

    destroyInstance(container);

    let xml;
    try {
        const from = measures[0].number;
        const to = measures[measures.length - 1].number;
        xml = extractMeasureRange(xmlString, from, to);
    } catch (err) {
        console.warn('renderer: falha ao extrair faixa de compassos', err);
        container.innerHTML = '';
        measures.forEach(m => renderFallback(container, m));
        return;
    }

    const osmd = new OSMD.OpenSheetMusicDisplay(container, {
        ...DEFAULT_OPTIONS,
        setWantedNumberOfMeasuresPerRow: measures.length,
        ...options,
    });

    enableGhostNoteParentheses(osmd);

    try {
        await osmd.load(xml);
        osmd.render();
        hideClefsInSVG(container);
        instances.set(container, osmd);
        scaleSVG(container);
    } catch (err) {
        console.warn('renderer: falha ao renderizar compassos', err);
        container.innerHTML = '';
        measures.forEach(m => renderFallback(container, m));
    }
}

export function destroyInstance(container) {
    const osmd = instances.get(container);
    if (osmd) {
        try { osmd.clear(); } catch { /* noop */ }
        instances.delete(container);
    }
    container.innerHTML = '';
}

export function isOSMDReady() {
    return !!window.opensheetmusicdisplay;
}

export function waitForOSMD(timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
        if (isOSMDReady()) return resolve();

        const interval = setInterval(() => {
            if (isOSMDReady()) {
                clearInterval(interval);
                resolve();
            }
        }, 100);

        setTimeout(() => {
            clearInterval(interval);
            reject(new Error('OSMD não carregou dentro do tempo esperado.'));
        }, timeoutMs);
    });
}

export async function renderAll(items, xmlString) {
    await Promise.all(
        items.map(({ container, measures }) => {
            if (!measures?.length) return Promise.resolve();
            if (measures.length === 1) return renderMeasure(container, measures[0], xmlString);
            return renderMeasures(container, measures, xmlString);
        })
    );
}

/* ── EXTRAÇÃO ROBUSTA DE RANGE ───────────────────────────────── */

function extractMeasureRange(xmlString, from, to) {
    const doc = new DOMParser().parseFromString(xmlString, 'application/xml');
    const parseError = doc.querySelector('parsererror');
    if (parseError) throw new Error(parseError.textContent || 'XML inválido');

    const root = doc.documentElement;
    if (!root || root.tagName !== 'score-partwise') {
        throw new Error('Apenas score-partwise é suportado.');
    }

    const partList = doc.querySelector('part-list');
    if (!partList) throw new Error('MusicXML sem part-list.');

    const partId = chooseTargetPartId(doc);
    const part = getPartById(doc, partId) || doc.querySelector('part');
    if (!part) throw new Error('MusicXML sem part.');

    const measuresInPart = Array.from(part.querySelectorAll(':scope > measure'));

    const targetMeasures = measuresInPart.filter(m => {
        const n = parseMeasureNumber(m.getAttribute('number'));
        return Number.isFinite(n) && n >= from && n <= to;
    });

    if (!targetMeasures.length) {
        throw new Error(`Compassos ${from}–${to} não encontrados.`);
    }

    ensureAttributesAtRangeStart(targetMeasures[0], measuresInPart);
    forceFiveLineStaffAtRangeStart(targetMeasures[0]);

    const newDoc = document.implementation.createDocument(
        root.namespaceURI || null,
        root.nodeName,
        null
    );

    const newRoot = newDoc.documentElement;
    Array.from(root.attributes).forEach(attr => {
        newRoot.setAttribute(attr.name, attr.value);
    });

    ['work', 'movement-number', 'movement-title', 'identification', 'defaults', 'credit']
        .forEach(tag => {
            root.querySelectorAll(`:scope > ${tag}`).forEach(el => {
                newRoot.appendChild(newDoc.importNode(el, true));
            });
        });

    const newPartList = newDoc.createElement('part-list');
    const chosenScorePart =
        partId
            ? partList.querySelector(`score-part[id="${cssEscape(partId)}"]`)
            : partList.querySelector('score-part');

    if (chosenScorePart) {
        newPartList.appendChild(newDoc.importNode(chosenScorePart, true));
    } else {
        const fallbackSP = partList.querySelector('score-part');
        if (fallbackSP) newPartList.appendChild(newDoc.importNode(fallbackSP, true));
    }
    newRoot.appendChild(newPartList);

    const newPart = newDoc.importNode(part.cloneNode(false), true);
    targetMeasures.forEach(m => {
        const newM = newDoc.importNode(m, true);

        forceStaffOneOnNotes(newM); // <- adicionar aqui

        newM.querySelectorAll('notehead').forEach(nh => {
            const val = (nh.textContent || '').trim().toLowerCase();
            if (val === 'ghost' || nh.getAttribute('parentheses') === 'yes') {
                nh.setAttribute('parentheses', 'yes');
                if (val === 'ghost') nh.textContent = 'normal';
            }
        });

        newPart.appendChild(newM);
    });
    newRoot.appendChild(newPart);

    const xmlBody = new XMLSerializer().serializeToString(newDoc);
    return `<?xml version="1.0" encoding="UTF-8"?>\n${xmlBody}`;
}

function chooseTargetPartId(doc) {
    const scoreParts = Array.from(doc.querySelectorAll('part-list > score-part'));
    if (!scoreParts.length) return null;

    let bestId = null;
    let bestScore = -1;

    for (const sp of scoreParts) {
        const id = sp.getAttribute('id');
        if (!id) continue;

        const txt = (sp.textContent || '').toLowerCase();
        let score = 0;

        if (/drum|drums|bateria|percuss/i.test(txt)) score += 8;
        if (sp.querySelector('midi-channel')?.textContent?.trim() === '10') score += 6;

        const part = getPartById(doc, id);
        if (part?.querySelector('unpitched')) score += 10;
        if (part?.querySelector('clef > sign')?.textContent?.trim().toLowerCase() === 'percussion') score += 10;

        if (score > bestScore) {
            bestScore = score;
            bestId = id;
        }
    }

    return bestId || scoreParts[0].getAttribute('id');
}

function getPartById(doc, id) {
    if (!id) return null;
    return Array.from(doc.querySelectorAll('part'))
        .find(p => p.getAttribute('id') === id) ?? null;
}

function parseMeasureNumber(raw) {
    if (!raw) return NaN;
    const m = String(raw).match(/\d+/);
    return m ? parseInt(m[0], 10) : NaN;
}

function ensureAttributesAtRangeStart(firstTargetMeasure, allMeasuresInPart) {
    if (!firstTargetMeasure) return;

    // Verifica se o próprio compasso já tem attributes com dados reais
    const ownAttrs = firstTargetMeasure.querySelector(':scope > attributes');
    if (ownAttrs && hasRealMusicData(ownAttrs)) {
        sanitizeAttributes(ownAttrs);
        return;
    }

    const firstNum = parseMeasureNumber(firstTargetMeasure.getAttribute('number'));

    // Precisamos construir um attributes completo por acumulação:
    // alguns XMLs separam divisions/time/clef em compassos diferentes.
    // Estratégia: varrer do início até firstNum e acumular os valores mais recentes
    // de cada campo relevante (divisions, key, time, clef).
    let accumulated = {
        divisions: null,
        key: null,
        time: null,
        clef: null,
    };

    for (let i = 0; i < allMeasuresInPart.length; i++) {
        const m = allMeasuresInPart[i];
        const n = parseMeasureNumber(m.getAttribute('number'));
        if (!Number.isFinite(n) || n > firstNum) break;

        const attrs = m.querySelector(':scope > attributes');
        if (!attrs) continue;

        const divEl = attrs.querySelector(':scope > divisions');
        const keyEl = attrs.querySelector(':scope > key');
        const timeEl = attrs.querySelector(':scope > time');
        const clefEl = attrs.querySelector(':scope > clef');

        if (divEl) accumulated.divisions = divEl.cloneNode(true);
        if (keyEl) accumulated.key = keyEl.cloneNode(true);
        if (timeEl) accumulated.time = timeEl.cloneNode(true);
        if (clefEl) accumulated.clef = clefEl.cloneNode(true);
    }

    // Monta um attributes limpo com os dados acumulados na ordem correta do MusicXML
    const doc = firstTargetMeasure.ownerDocument;
    const newAttrs = doc.createElement('attributes');

    if (accumulated.divisions) newAttrs.appendChild(accumulated.divisions);
    if (accumulated.key) newAttrs.appendChild(accumulated.key);
    if (accumulated.time) newAttrs.appendChild(accumulated.time);
    if (accumulated.clef) newAttrs.appendChild(accumulated.clef);

    // Força 5 linhas explicitamente — sem isso o OSMD renderiza pauta de 1 linha
    // quando encontra notas <unpitched> com clave de percussão.
    const staffDetails = doc.createElement('staff-details');
    staffDetails.setAttribute('number', '1');

    const staffType = doc.createElement('staff-type');
    staffType.textContent = 'regular';
    staffDetails.appendChild(staffType);

    const staffLines = doc.createElement('staff-lines');
    staffLines.textContent = '5';
    staffDetails.appendChild(staffLines);

    newAttrs.appendChild(staffDetails);

    // Remove o attributes antigo (que pode ser só measure-style) e insere o novo
    if (ownAttrs) ownAttrs.remove();

    const firstChild = firstTargetMeasure.firstElementChild;
    if (firstChild) firstTargetMeasure.insertBefore(newAttrs, firstChild);
    else firstTargetMeasure.appendChild(newAttrs);
}

/** Retorna true se o bloco <attributes> contém dados musicais reais (não só measure-style) */
function hasRealMusicData(attrsEl) {
    return !!(
        attrsEl.querySelector(':scope > divisions') ||
        attrsEl.querySelector(':scope > time') ||
        attrsEl.querySelector(':scope > clef')
    );
}

function forceFiveLineStaffAtRangeStart(measureEl) {
    const doc = measureEl.ownerDocument;
    let attrs = measureEl.querySelector(':scope > attributes');
    if (!attrs) {
        attrs = doc.createElement('attributes');
        measureEl.insertBefore(attrs, measureEl.firstElementChild || null);
    }

    // limpa conflitos
    attrs.querySelectorAll(':scope > staves').forEach(el => el.remove());
    attrs.querySelectorAll(':scope > clef').forEach(el => el.remove());
    attrs.querySelectorAll(':scope > staff-details').forEach(el => el.remove());

    // staves=1
    const staves = doc.createElement('staves');
    staves.textContent = '1';

    const anchor =
        attrs.querySelector(':scope > time') ??
        attrs.querySelector(':scope > key') ??
        attrs.querySelector(':scope > divisions');

    if (anchor) anchor.after(staves);
    else attrs.appendChild(staves);

    // WORKAROUND OSMD: clef G para garantir 5 linhas no recorte
    const clef = doc.createElement('clef');
    clef.setAttribute('number', '1');

    const sign = doc.createElement('sign');
    sign.textContent = 'G';
    clef.appendChild(sign);

    const line = doc.createElement('line');
    line.textContent = '2';
    clef.appendChild(line);

    staves.after(clef);

    const sd = doc.createElement('staff-details');
    sd.setAttribute('number', '1');

    const sl = doc.createElement('staff-lines');
    sl.textContent = '5';
    sd.appendChild(sl);

    clef.after(sd);
}

function sanitizeAttributes(attributesEl) {
    if (!attributesEl) return;
    // Remove multi-rest (causa compassos fantasma)
    attributesEl.querySelectorAll('measure-style > multiple-rest')
        .forEach(el => el.closest('measure-style')?.remove());
    // NÃO remove staff-details — forcePercussionAtRangeStart já substitui por staff-lines=5
}

function cssEscape(value) {
    return String(value).replace(/"/g, '\\"');
}

function enableGhostNoteParentheses(osmd) {
    if (osmd.rules) {
        osmd.rules.RenderNoteHeadParentheses = true;
    } else if (osmd.EngravingRules) {
        osmd.EngravingRules.RenderNoteHeadParentheses = true;
    }
}

/* ── VISUAL / FALLBACK ───────────────────────────────────────── */

function scaleSVG(container) {
    const svg = container.querySelector('svg');
    if (!svg) return;

    // Melhor para evitar corte vertical/horizontal no card
    svg.style.width = '100%';
    svg.style.height = 'auto';
    svg.style.display = 'block';
    svg.style.maxWidth = '100%';
    svg.style.maxHeight = '100%';
    svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');
}

function renderFallback(container, measure) {
    const noteCount = measure.notes?.filter(n => !n.isChord).length ?? 0;
    const timeSig = measure.timeSignature
        ? `${measure.timeSignature.beats}/${measure.timeSignature.beatType}`
        : '4/4';

    container.innerHTML = `
        <div class="measure-fallback">
            Compasso ${measure.number}<br>
            <span class="measure-fallback-sub">${timeSig} · ${noteCount} notas</span>
        </div>`;
}

function forceStaffOneOnNotes(measureEl) {
    const doc = measureEl.ownerDocument;
    measureEl.querySelectorAll('note').forEach(note => {
        if (!note.querySelector(':scope > staff')) {
            const staff = doc.createElement('staff');
            staff.textContent = '1';

            // Ordem comum: ... <voice> ... <staff> ... <type>
            const voice = note.querySelector(':scope > voice');
            const type = note.querySelector(':scope > type');

            if (voice) voice.after(staff);
            else if (type) type.before(staff);
            else note.appendChild(staff);
        }
    });
}

function hideClefsInSVG(container) {
    const svg = container.querySelector('svg');
    if (!svg) return;

    // VexFlow/OSMD costuma usar essa classe para clave
    svg.querySelectorAll('g.vf-clef').forEach(el => el.remove());
}