// parser.js

function decodeHTMLEntities(str) {
    const el = document.createElement('textarea');
    el.innerHTML = str;
    return el.value;
}

export async function parseMusicXML(input) {
    let xmlString;

    if (typeof input === 'string') {
        xmlString = decodeHTMLEntities(input);
    } else if (input instanceof Blob) {
        xmlString = await input.text();
    } else {
        throw new Error('parseMusicXML: entrada inválida. Esperado string ou Blob.');
    }

    const doc = new DOMParser().parseFromString(xmlString, 'application/xml');

    const parseError = doc.querySelector('parsererror');
    if (parseError) {
        throw new Error(`MusicXML inválido: ${parseError.textContent}`);
    }

    return extractScore(doc, xmlString);
}

/* ── EXTRAÇÃO DO SCORE ───────────────────────────────────────── */

function extractScore(doc, rawXML) {
    const root = doc.documentElement;

    if (root.tagName !== 'score-partwise') {
        throw new Error('Apenas MusicXML no formato score-partwise é suportado.');
    }

    const title    = getText(doc, 'movement-title') || getText(doc, 'work-title') || '';
    const composer = getText(doc, 'creator[type="composer"]') || '';

    const targetPartId = chooseTargetPartId(doc);
    const firstPart =
        getPartById(doc, targetPartId) ||
        doc.querySelector('part');

    if (!firstPart) throw new Error('Nenhuma parte encontrada no arquivo.');

    const measures      = extractMeasures(firstPart);
    const firstMeasure  = measures[0] ?? null;
    const timeSignature = firstMeasure?.timeSignature ?? { beats: 4, beatType: 4 };
    const tempo         = extractTempo(doc);

    return { title, composer, timeSignature, tempo, measures, _rawXML: rawXML };
}

/* ── EXTRAÇÃO DE COMPASSOS ───────────────────────────────────── */

function extractMeasures(part) {
    const measureEls = part.querySelectorAll(':scope > measure');
    const measures = [];
    let currentTimeSig = null;

    measureEls.forEach(el => {
        const number = parseMeasureNumber(el.getAttribute('number'));
        const timeSigEl = el.querySelector('time');
        let timeSignature = null;

        if (timeSigEl) {
            const beats = parseInt(getText(timeSigEl, 'beats'), 10);
            const beatType = parseInt(getText(timeSigEl, 'beat-type'), 10);

            if (
                Number.isFinite(beats) &&
                Number.isFinite(beatType) &&
                (!currentTimeSig ||
                    currentTimeSig.beats !== beats ||
                    currentTimeSig.beatType !== beatType)
            ) {
                currentTimeSig = { beats, beatType };
                timeSignature = { beats, beatType };
            }
        }

        measures.push({ number, timeSignature, notes: extractNotes(el) });
    });

    let propagated = { beats: 4, beatType: 4 };
    for (const m of measures) {
        if (m.timeSignature) propagated = m.timeSignature;
        else m.timeSignature = propagated;
    }

    return measures;
}

/* ── EXTRAÇÃO DE NOTAS ───────────────────────────────────────── */

function extractNotes(measureEl) {
    const noteEls = measureEl.querySelectorAll('note');
    const notes = [];

    noteEls.forEach(el => {
        const isRest  = !!el.querySelector('rest');
        const isChord = !!el.querySelector('chord');
        const pitch   = isRest ? 'rest' : extractPitch(el);

        const duration   = parseInt(getText(el, 'duration'), 10) || 0;
        const type       = getText(el, 'type') || 'quarter';
        const stem       = getText(el, 'stem') || null;
        const voice      = parseInt(getText(el, 'voice'), 10) || 1;
        const staff      = parseInt(getText(el, 'staff'), 10) || 1;

        const noteheadEl = el.querySelector('notehead');
        const notehead = noteheadEl ? noteheadEl.textContent.trim() : null;
        const noteheadParentheses =
            noteheadEl?.getAttribute('parentheses') === 'yes';

        notes.push({
            pitch, duration, type, isChord, stem, notehead, noteheadParentheses, staff, voice
        });
    });

    return notes;
}

function extractPitch(noteEl) {
    const pitchEl = noteEl.querySelector('pitch');
    if (!pitchEl) return 'rest';

    const step       = getText(pitchEl, 'step') || '';
    const octave     = getText(pitchEl, 'octave') || '';
    const alter      = getText(pitchEl, 'alter');
    const accidental = alter === '1' ? '#' : alter === '-1' ? 'b' : '';

    return `${step}${accidental}${octave}`;
}

/* ── EXTRAÇÃO DE ANDAMENTO ───────────────────────────────────── */

function extractTempo(doc) {
    const soundEl = doc.querySelector('sound[tempo]');
    if (soundEl) return parseFloat(soundEl.getAttribute('tempo'));

    const perMinute = doc.querySelector('per-minute');
    if (perMinute) return parseFloat(perMinute.textContent);

    return null;
}

/* ── SELEÇÃO DE PARTE (DRUMS/PERC) ───────────────────────────── */

function chooseTargetPartId(doc) {
    const scoreParts = Array.from(doc.querySelectorAll('part-list > score-part'));
    if (!scoreParts.length) return null;

    let bestId    = null;
    let bestScore = -1;

    for (const sp of scoreParts) {
        const id = sp.getAttribute('id');
        if (!id) continue;

        const text = (sp.textContent || '').toLowerCase();
        let score = 0;

        // Prioridade 1: ID da parte contém "drum" ou "perc"
        if (id.toLowerCase().includes('drum') || id.toLowerCase().includes('perc')) score += 10;

        // Prioridade 2: Nome da parte contém "drum", "bateria", "percussão"
        if (/drum|drums|bateria|percuss/i.test(text)) score += 5;

        // Prioridade 3: Canal MIDI 10 (comum para percussão)
        if (sp.querySelector('midi-instrument')?.querySelector('midi-channel')?.textContent?.trim() === '10') score += 6;

        // Prioridade 4: Clave de percussão explícita (embora nem sempre presente na part-list)
        // Isso é mais difícil de detectar na part-list, mas pode ser um indicador.
        // Se houver um <clef><sign>PERC</sign></clef> em algum lugar da part-list, seria um bom sinal.
        // Por enquanto, vamos focar nos outros.

        if (score > bestScore) {
            bestScore = score;
            bestId    = id;
        }
    }

    // Se não encontrou nada específico, retorna o ID da primeira parte.
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

/* ── UTILITÁRIOS ─────────────────────────────────────────────── */

function getText(parent, selector) {
    const el = typeof parent.querySelector === 'function'
        ? parent.querySelector(selector)
        : null;
    return el ? el.textContent.trim() : '';
}

/* ── HELPERS EXPORTADOS ──────────────────────────────────────── */

export function groupMeasures(measures, size = 4) {
    const groups = [];
    for (let i = 0; i < measures.length; i += size) {
        groups.push(measures.slice(i, i + size));
    }
    return groups;
}

export function getMeasureByNumber(measures, number) {
    return measures.find(m => m.number === number) ?? null;
}

export function looksLikeMusicXML(str) {
    return str.includes('<score-partwise') || str.includes('<score-timewise');
}