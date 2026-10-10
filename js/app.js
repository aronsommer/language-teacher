// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

import { GoogleGenAI, Modality } from "https://cdn.jsdelivr.net/npm/@google/genai@2.27.0/+esm";

const LIVE_MODEL = "gemini-3.8-live";
const TEXT_MODEL = "gemini-3.5-flash-lite";
// A new session is given at most this many characters of the chat.
const HISTORY_CHARS = 8000;
// Language name -> BCP-47 code.
const LANGUAGES = {
  Albanian: "sq",
  Bulgarian: "bg",
  Catalan: "ca",
  Croatian: "hr",
  Czech: "cs",
  Danish: "da",
  Dutch: "nl",
  English: "en",
  Estonian: "et",
  Finnish: "fi",
  French: "fr",
  German: "de",
  Greek: "el",
  Hungarian: "hu",
  Icelandic: "is",
  Indonesian: "id",
  Italian: "it",
  Latvian: "lv",
  Lithuanian: "lt",
  Mandarin: "zh-Hans",
  Norwegian: "no",
  Polish: "pl",
  Portuguese: "pt-BR",
  Romanian: "ro",
  Russian: "ru",
  Serbian: "sr",
  Slovak: "sk",
  Slovenian: "sl",
  Spanish: "es",
  Swedish: "sv",
  Turkish: "tr",
  Ukrainian: "uk",
  Vietnamese: "vi",
};
// Voice name -> style, by gender.
const VOICES = {
  Female: {
    Achernar: "Soft",
    Aoede: "Breezy",
    Autonoe: "Bright",
    Callirrhoe: "Easy-going",
    Despina: "Smooth",
    Erinome: "Clear",
    Gacrux: "Mature",
    Kore: "Firm",
    Laomedeia: "Upbeat",
    Leda: "Youthful",
    Pulcherrima: "Forward",
    Sulafat: "Warm",
    Vindemiatrix: "Gentle",
    Zephyr: "Bright",
  },
  Male: {
    Achird: "Friendly",
    Algenib: "Gravelly",
    Algieba: "Smooth",
    Alnilam: "Firm",
    Charon: "Informative",
    Enceladus: "Breathy",
    Fenrir: "Excitable",
    Iapetus: "Clear",
    Orus: "Firm",
    Puck: "Upbeat",
    Rasalgethi: "Informative",
    Sadachbia: "Lively",
    Sadaltager: "Knowledgeable",
    Schedar: "Even",
    Umbriel: "Easy-going",
    Zubenelgenubi: "Casual",
  },
};

const $ = (id) => document.getElementById(id);
const keyInput = $("key");
const learnSelect = $("learnLanguage");
const nativeSelect = $("nativeLanguage");
const voiceSelect = $("voice");
const translationMode = $("translationMode");
const wordMode = $("wordMode");
const toggle = $("toggle");
const clear = $("clear");
const log = $("log");
const said = $("said");
const main = log.parentElement;
const status = $("status");
const hint = $("hint");
const notes = $("notes");
const settings = $("settings");
const openSettings = $("openSettings");
const addKey = $("addKey");
const fullscreen = $("fullscreen");
const theme = $("theme");
const systemDark = matchMedia("(prefers-color-scheme: dark)");

let running = false;
// Number of the current session; callbacks of older sessions are ignored.
let run = 0;
let ai, session, micStream, micContext, playContext;
let nextPlayTime = 0;
const sources = new Set();
const open = { user: null, teacher: null };
// The turn in which the message in the footer was said.
let turn;
// Whether the chat scrolls to its end on new text. Scrolling away from the end turns it off.
let pinned = true;
// Timers of teacher text that waits for its audio to play.
const reveals = new Set();
// Times of the translation requests of the last minute.
let recent = [];

// Local storage is shared by every page of the domain, so the names carry the app's.
const store = {
  get: (name) => localStorage.getItem(`language-teacher:${name}`),
  set: (name, value) => localStorage.setItem(`language-teacher:${name}`, value),
};

for (const select of [learnSelect, nativeSelect]) {
  select.append(...Object.keys(LANGUAGES).map((language) => new Option(language)));
}
for (const [gender, voices] of Object.entries(VOICES)) {
  const group = document.createElement("optgroup");
  group.label = gender;
  group.append(
    ...Object.entries(voices).map(([name, style]) => new Option(`${name} (${style})`, name)),
  );
  voiceSelect.append(group);
}
learnSelect.value = store.get("learnLanguage") ?? "Polish";
nativeSelect.value = store.get("nativeLanguage") ?? "German";
voiceSelect.value = store.get("voice") ?? "Kore";
keyInput.value = store.get("apiKey") ?? "";
// On unless it was turned off.
translationMode.checked = store.get("translation") !== "";
wordMode.checked = store.get("wordByWord") === "1";
applyTranslation();
applyLanguages();
applyKey();
applyTheme();

keyInput.addEventListener("input", () => {
  store.set("apiKey", keyInput.value.trim());
  applyKey();
});
for (const select of [learnSelect, nativeSelect]) {
  select.addEventListener("change", () => {
    store.set(select.id, select.value);
    applyLanguages();
  });
}
voiceSelect.addEventListener("change", () => store.set("voice", voiceSelect.value));
for (const [box, name] of [
  [translationMode, "translation"],
  [wordMode, "wordByWord"],
]) {
  box.addEventListener("change", () => {
    store.set(name, box.checked ? "1" : "");
    applyTranslation();
    // Hiding or swapping the translations changes the height of the bubbles.
    scrollToEnd();
  });
}
toggle.addEventListener("click", () => (running ? stop() : start()));
notes.addEventListener("input", () => store.set(notesKey(), notes.value));
for (const button of [openSettings, addKey]) {
  button.addEventListener("click", () => settings.showModal());
}
// A press on the backdrop lands on the dialog itself. A drag that only ends there, like a
// text selection, also clicks the dialog, so the press has to start on the backdrop.
let pressedBackdrop = false;
settings.addEventListener("pointerdown", (event) => {
  pressedBackdrop = event.target === settings;
});
settings.addEventListener("click", (event) => {
  if (pressedBackdrop && event.target === settings) settings.close();
});
// Closing hands the focus back to the button that opened it, which can show its focus ring.
settings.addEventListener("close", () => document.activeElement.blur());
fullscreen.addEventListener("click", () =>
  document.fullscreenElement
    ? document.exitFullscreen()
    : document.documentElement.requestFullscreen(),
);
document.addEventListener("fullscreenchange", () => {
  fullscreen.textContent = document.fullscreenElement ? "fullscreen_exit" : "fullscreen";
});
theme.addEventListener("click", () => {
  store.set("theme", isDark() ? "light" : "dark");
  applyTheme();
});
systemDark.addEventListener("change", applyTheme);
// From pwa-install.js.
initPwaInstall();
document.addEventListener("visibilitychange", keepAwake);
keepAwake();
// Within two pixels, as scroll positions are fractional.
main.addEventListener("scroll", () => {
  pinned = main.scrollHeight - main.scrollTop - main.clientHeight < 2;
});
clear.addEventListener("click", () => {
  stop();
  log.replaceChildren();
  said.replaceChildren();
  // A session that already ended left its last message standing.
  status.textContent = "";
});

// Keeps the screen on while the page is shown. The browser drops the lock when the tab is
// hidden, so it is requested again when the tab is shown. Fails silently where unsupported.
function keepAwake() {
  if (!document.hidden) navigator.wakeLock?.request("screen").catch(() => {});
}

// A stored choice wins over the system's theme.
function isDark() {
  const stored = store.get("theme");
  return stored ? stored === "dark" : systemDark.matches;
}

// The button shows the theme it switches to.
function applyTheme() {
  document.documentElement.style.colorScheme = store.get("theme") ?? "";
  theme.textContent = isDark() ? "light_mode" : "dark_mode";
}

// Without a key, the stylesheet swaps Start and Clear for a button that opens the settings.
function applyKey() {
  const missing = !keyInput.value.trim();
  document.body.classList.toggle("no-key", missing);
  hint.textContent = missing
    ? "Learn a language by speaking with an AI teacher. To begin, get a free Gemini API key and add it in the settings."
    : "Press Start and just speak. Your teacher talks with you.";
}

// Word mode needs translation: without it, its checkbox is locked and it is off.
function applyTranslation() {
  const on = translationMode.checked;
  wordMode.disabled = !on;
  document.body.classList.toggle("no-translation", !on);
  document.body.classList.toggle("word-mode", on && wordMode.checked);
}

// Blocks choosing the same language twice and shows the pair's notes.
function applyLanguages() {
  for (const option of learnSelect.options) {
    option.disabled = option.value === nativeSelect.value;
  }
  for (const option of nativeSelect.options) {
    option.disabled = option.value === learnSelect.value;
  }
  // Lets the browser pick the language's glyphs, e.g. Chinese rather than Japanese forms.
  log.lang = said.lang = LANGUAGES[learnSelect.value];
  showNotes();
}

function setRunning(value, message) {
  running = value;
  toggle.classList.toggle("bad", value);
  keyInput.disabled = learnSelect.disabled = nativeSelect.disabled = voiceSelect.disabled = value;
  status.textContent = message;
}

function notesKey() {
  return `notes:${learnSelect.value}:${nativeSelect.value}`;
}

function showNotes() {
  notes.value = store.get(notesKey()) ?? "";
}

function teacherPrompt(learn, native, name, gender, learnerNotes) {
  const wishes = learnerNotes
    ? `

The learner wrote these notes for you. Follow them:
${learnerNotes}`
    : "";
  return `You are a warm, patient ${learn} teacher in a spoken one-on-one lesson. Your name is ${name} and you are ${gender.toLowerCase()}. The learner is a beginner whose mother language is ${native}.
- Speak only ${learn} and ${native}, never any other language, whatever language you hear or are addressed in.
- Speak ${learn} by default: slowly, in short simple sentences, with basic vocabulary.
- When the learner seems not to understand, hesitates, answers in ${native} or asks for help, explain briefly in ${native}, then return to ${learn} and let them try again.
- If you cannot make out what the learner said, ask them in ${native} to say it again.
- Correct mistakes gently: say the correct ${learn} form once and move on. Never ask the learner to repeat after you unless they ask for pronunciation practice.
- Ask one question at a time and keep your turns short so the learner speaks a lot.${wishes}`;
}

async function start() {
  setRunning(true, "Connecting…");
  toggle.disabled = clear.disabled = true;
  const id = ++run;
  try {
    if (!navigator.mediaDevices) {
      throw new Error("The microphone needs HTTPS or localhost.");
    }
    ai = new GoogleGenAI({ apiKey: keyInput.value.trim() });
    micContext = new AudioContext({ sampleRate: 16000 });
    playContext = new AudioContext({ sampleRate: 24000 });
    const languageCodes = [LANGUAGES[learnSelect.value], LANGUAGES[nativeSelect.value]];
    // connect() never settles when the connection ends before its setup is done, e.g. on a
    // wrong key. This settles then, so the wait below ends.
    const ended = Promise.withResolvers();
    const end = (message) => {
      ended.resolve();
      if (id === run) stop(message);
    };
    // The three need nothing of each other, so they run at once. Each lands in its variable
    // as soon as it is done, so stop() finds it.
    const tasks = [
      navigator.mediaDevices
        .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
        .then((stream) => (micStream = stream)),
      micContext.audioWorklet.addModule("js/mic-worklet.js?v=__BUILD_TIMESTAMP__"),
      Promise.race([
        ai.live
          .connect({
            model: LIVE_MODEL,
            config: {
              responseModalities: [Modality.AUDIO],
              systemInstruction: teacherPrompt(
                learnSelect.value,
                nativeSelect.value,
                voiceSelect.value,
                // The label of the voice's group.
                voiceSelect.selectedOptions[0].parentElement.label,
                notes.value.trim(),
              ),
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceSelect.value } },
              },
              inputAudioTranscription: { languageCodes },
              outputAudioTranscription: { languageCodes },
              // Past 16k tokens the oldest turns are dropped, down to half.
              contextWindowCompression: {
                triggerTokens: "16000",
                slidingWindow: {},
              },
            },
            callbacks: {
              onmessage: (message) => id === run && onmessage(message),
              onerror: (event) => end(event.message || "Connection error."),
              onclose: (event) =>
                end(`Gemini closed the connection: ${event.reason || "no reason given"}`),
            },
          })
          .then((s) => (session = s)),
        ended.promise,
      ]),
    ];
    // All of them settle before the first failure is thrown, so stop() below releases the
    // others too.
    await Promise.allSettled(tasks);
    await Promise.all(tasks);
    // Stopped meanwhile, e.g. because Gemini closed the connection: stop() releases what
    // arrived since.
    if (!running) return stop();
    const mic = new AudioWorkletNode(micContext, "mic", { numberOfOutputs: 0 });
    mic.port.onmessage = ({ data }) =>
      session?.sendRealtimeInput({
        audio: {
          data: new Uint8Array(data.buffer).toBase64(),
          mimeType: "audio/pcm;rate=16000",
        },
      });
    micContext.createMediaStreamSource(micStream).connect(mic);
    // A chat that is still shown goes on.
    const turns = chatTurns();
    if (turns.length) session.sendClientContent({ turns, turnComplete: false });
    session.sendRealtimeInput({
      text: turns.length
        ? `Continue our lesson in ${learnSelect.value} where we left off.`
        : `Greet me in ${learnSelect.value} and begin the lesson.`,
    });
    status.textContent = "Listening. Just speak.";
  } catch (error) {
    let message = error.message;
    // NotAllowedError only comes from the microphone request.
    if (error.name === "NotAllowedError") {
      const { state } = await navigator.permissions
        .query({ name: "microphone" })
        .catch(() => ({ state: "unknown" }));
      message = `Microphone blocked (${error.message}; site permission: ${state}). Allow it for this site in the browser's site settings and for the browser app in the system settings.`;
    }
    stop(message);
  } finally {
    toggle.disabled = clear.disabled = false;
  }
}

// Also releases when already stopped, for a start that was stopped while it waited.
function stop(message = "") {
  if (running) setRunning(false, message);
  session?.close();
  micStream?.getTracks().forEach((track) => track.stop());
  micContext?.close();
  playContext?.close();
  session = micStream = micContext = playContext = null;
  sources.clear();
  nextPlayTime = 0;
  dropReveals();
  closeBubble("user");
  closeBubble("teacher");
}

// The end of the chat as turns for Gemini, in the order it was said: the messages in the
// footer belong to the turn they were said in.
function chatTurns() {
  const turns = [...log.children].flatMap((section) =>
    [...section.children, ...(section === turn ? said.children : [])].map((node) => ({
      role: node.classList.contains("user") ? "user" : "model",
      parts: [{ text: node.firstChild.textContent }],
    })),
  );
  let room = HISTORY_CHARS;
  const cut = turns.findLastIndex(({ parts }) => (room -= parts[0].text.length) < 0);
  return turns.slice(cut + 1);
}

function onmessage({ serverContent: content }) {
  if (!running || !content) return;
  if (content.interimInputTranscription?.text) {
    openBubble("user").interim = content.interimInputTranscription.text;
    render(open.user);
  }
  if (content.inputTranscription?.text) {
    appendText("user", content.inputTranscription.text);
  }
  if (content.inputTranscription?.finished) closeBubble("user");
  if (content.outputTranscription?.text) {
    closeBubble("user");
    // Reveal the text when the audio queued so far has played.
    const delay = Math.max(0, nextPlayTime - playContext.currentTime) * 1000;
    appendText("teacher", content.outputTranscription.text, delay);
  }
  for (const part of content.modelTurn?.parts ?? []) {
    if (part.inlineData?.data) play(part.inlineData.data);
  }
  if (content.interrupted) stopPlayback();
  // Translate early; the turn only completes after playback.
  if (content.generationComplete && open.teacher) translate(open.teacher, true);
  if (content.turnComplete || content.interrupted) closeBubble("teacher");
}

function play(base64) {
  const pcm = new Int16Array(Uint8Array.fromBase64(base64).buffer);
  const buffer = playContext.createBuffer(1, pcm.length, 24000);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 0x8000;

  const source = playContext.createBufferSource();
  source.buffer = buffer;
  source.connect(playContext.destination);
  source.onended = () => sources.delete(source);
  nextPlayTime = Math.max(nextPlayTime, playContext.currentTime);
  source.start(nextPlayTime);
  nextPlayTime += buffer.duration;
  sources.add(source);
}

function stopPlayback() {
  for (const source of sources) source.stop();
  sources.clear();
  nextPlayTime = 0;
  dropReveals();
}

function openBubble(role) {
  if (!open[role]) {
    const node = element("article", role);
    node.append(element("p", "text"), element("p", "words"), element("p", "natural"));
    // The teacher's message starts a turn, as does the first message of a chat.
    if (role === "teacher" || !log.lastElementChild) log.append(element("section", ""));
    if (role === "teacher") {
      log.lastElementChild.append(node);
      // Her new message scrolls into view wherever the chat is.
      pinned = true;
    } else {
      // The learner's message before this one leaves the footer for the turn it was said in.
      turn?.append(...said.children);
      turn = log.lastElementChild;
      said.append(node);
    }
    open[role] = {
      node,
      text: "",
      shown: "",
      interim: "",
      // Length of the text already handed to translation.
      sent: 0,
      // Whether the unfinished rest was handed over too.
      flushed: false,
      // Word lists whose translation has not arrived.
      waiting: new Set(),
    };
  }
  return open[role];
}

function appendText(role, chunk, delay = 0) {
  const bubble = openBubble(role);
  bubble.text += chunk;
  bubble.interim = "";
  // Only the teacher's sentences go early: the requests a free key allows per minute are
  // few, and her words are the ones the learner waits for. The learner's text goes in one
  // piece when it ends.
  if (role === "teacher") translate(bubble);
  const show = () => {
    bubble.shown += chunk;
    render(bubble);
  };
  if (!delay) return show();
  const timer = setTimeout(() => {
    reveals.delete(timer);
    show();
  }, delay);
  reveals.add(timer);
}

// Discards teacher text whose audio will no longer play.
function dropReveals() {
  reveals.forEach(clearTimeout);
  reveals.clear();
  const bubble = open.teacher;
  if (!bubble) return;
  bubble.text = bubble.shown;
  // Translations that cover unspoken text are dropped and redone.
  if (bubble.sent > bubble.text.length) {
    bubble.node.querySelectorAll(".words, .natural").forEach((p) => p.replaceChildren());
    bubble.waiting.clear();
    bubble.sent = 0;
  }
}

function render({ node, shown, interim }) {
  const text = node.firstChild;
  text.textContent = shown;
  if (interim) text.append(element("span", "interim", interim));
  scrollToEnd();
}

function closeBubble(role) {
  const bubble = open[role];
  if (!bubble) return;
  open[role] = null;
  bubble.interim = "";
  render(bubble);
  if (bubble.text.trim()) translate(bubble, true);
  else bubble.node.remove();
}

// Word mode swaps the text for the words once all of it is translated.
function showWords(bubble) {
  const ready = bubble.flushed && bubble.sent >= bubble.text.length && !bubble.waiting.size;
  bubble.node.classList.toggle("glossed", ready);
}

// Translates the whole rest of the text with `all`, else only its complete sentences.
async function translate(bubble, all = false) {
  // A message that ends while translation is off stays untranslated.
  if (!translationMode.checked) return;
  const now = Date.now();
  recent = recent.filter((time) => now - time < 60000);
  const rest = bubble.text.slice(bubble.sent);
  // A mark after a digit ends nothing: "3." may be an ordinal.
  const sentences = rest.match(/^.*(?:(?<!\d)[.!?…]\s|[。！？])/s)?.[0] ?? "";
  // A free key allows 15 requests a minute, so sentences only go early after fewer than 7.
  const end = all ? rest.length : recent.length < 7 ? sentences.length : 0;
  bubble.sent += end;
  bubble.flushed ||= all;
  const text = rest.slice(0, end).trim();
  if (!text) return showWords(bubble);
  recent.push(now);
  const learn = learnSelect.value;
  const native = nativeSelect.value;
  const pinyin = [learn, native].includes("Mandarin");
  // Each request fills its own spans, so the sentences stay in order.
  const [glossed, natural] = [".words", ".natural"].map((p) =>
    bubble.node.querySelector(p).appendChild(element("span", "")),
  );
  bubble.waiting.add(glossed);
  showWords(bubble);
  try {
    const stream = await ai.models.generateContentStream({
      model: TEXT_MODEL,
      contents: text,
      config: {
        systemInstruction: `The text is from a lesson for a ${native} speaker learning ${learn}. Translate it into natural ${native}; if it is entirely in ${native}, translate it into ${learn} instead. Also list every word of the text in order as [word, meaning] pairs, the meaning being its literal translation into the other of the two languages in that context.${pinyin ? " Write Mandarin words in simplified Chinese characters, even where the text spells them in pinyin. Give every pair a third item: the pinyin with tone marks of its Mandarin side, whether that is the word or the meaning, and an empty string only when neither contains Chinese characters." : ""}`,
        temperature: 0,
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          properties: {
            translation: { type: "string" },
            words: {
              type: "array",
              items: {
                type: "array",
                items: { type: "string" },
                minItems: pinyin ? 3 : 2,
                maxItems: pinyin ? 3 : 2,
              },
            },
          },
          required: ["translation", "words"],
        },
      },
    });
    let json = "";
    for await (const chunk of stream) {
      json += chunk.text ?? "";
      // Show the translation as soon as its string is complete.
      const early = !natural.textContent && json.match(/"translation"\s*:\s*("(?:[^"\\]|\\.)*")/);
      if (early) {
        natural.textContent = `${JSON.parse(early[1])} `;
        scrollToEnd();
      }
    }
    const { translation, words } = JSON.parse(json);
    natural.textContent = `${translation} `;
    for (const [word, gloss, reading] of words) {
      const pair = element("span", "word", word);
      // Pinyin goes above the word, the meaning below.
      if (pinyin) pair.prepend(element("small", "", reading));
      pair.append(element("small", "", gloss));
      glossed.append(pair);
    }
    bubble.waiting.delete(glossed);
    showWords(bubble);
  } catch (error) {
    // The SDK's message holds the API's JSON error, behind a prefix when it came mid-stream.
    let reason = error.message;
    try {
      reason = JSON.parse(reason.slice(reason.indexOf("{"))).error.message;
    } catch {}
    if (!natural.textContent) {
      natural.textContent = `Translation failed: ${reason} `;
      // Word mode keeps the line of a failed translation visible.
      natural.className = "failed";
    }
  }
  scrollToEnd();
}

function element(tag, className, text = "") {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function scrollToEnd() {
  if (pinned) main.scrollTop = main.scrollHeight;
}
