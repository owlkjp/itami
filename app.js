const STORAGE_KEY = "healthVoiceLog.v1";
const LABELS_KEY = "healthVoiceLog.labels.v1";
const APP_VERSION = "v4.2";
const defaultSymptoms = [
  { key: "headache", label: "頭痛", color: "#e60000", aliases: ["頭痛", "頭"] },
  { key: "back", label: "腰", color: "#0057ff", aliases: ["腰", "腰の痛み"] },
  { key: "leg", label: "足", color: "#00a000", aliases: ["足", "足の痛み"] },
  { key: "tinnitus", label: "耳鳴り", color: "#8a00ff", aliases: ["耳鳴り"] },
  { key: "hand", label: "手", color: "#ff8c00", aliases: ["手", "手の痛み", "手のしびれ", "左腕のしびれ"] },
  { key: "sleep", label: "睡眠の悪さ", color: "#111111", aliases: ["眠れない", "眠りが浅い", "寝づらい"] }
];
const symptoms = loadSymptomLabels();

const fields = {
  date: document.querySelector("#entryDate"),
  weather: document.querySelector("#entryWeather"),
  tempHigh: document.querySelector("#entryTempHigh"),
  tempLow: document.querySelector("#entryTempLow"),
  text: document.querySelector("#entryText"),
  importText: document.querySelector("#importText"),
  importFile: document.querySelector("#importFile"),
  historyStart: document.querySelector("#historyStartDate"),
  historyEnd: document.querySelector("#historyEndDate"),
  historySort: document.querySelector("#historySort"),
  deleteStart: document.querySelector("#deleteStartDate"),
  deleteEnd: document.querySelector("#deleteEndDate"),
  doctorStart: document.querySelector("#doctorStartDate"),
  doctorEnd: document.querySelector("#doctorEndDate"),
  status: document.querySelector("#voiceStatus"),
  settingsStatus: document.querySelector("#settingsStatus"),
  reloadStatus: document.querySelector("#reloadStatus")
};

const scoreInputs = {
  headache: document.querySelector("#scoreHeadache"),
  back: document.querySelector("#scoreBack"),
  leg: document.querySelector("#scoreLeg"),
  tinnitus: document.querySelector("#scoreTinnitus"),
  hand: document.querySelector("#scoreHand"),
  sleep: document.querySelector("#scoreSleep")
};

let entries = loadEntries();
let deferredInstallPrompt = null;
let editingEntryId = null;
let activeRecognition = null;
let stopVoiceRequested = false;
let keepVoiceListening = false;
let voiceRestartTimer = null;

init();

function init() {
  fields.date.value = toLocalInputValue(new Date());
  setDefaultDoctorRange();
  renderSettings();
  applySymptomLabels();
  renderAppVersion();
  bindTabs();
  bindActions();
  renderAll();
  registerServiceWorker();
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab, .view").forEach(el => el.classList.remove("active"));
      button.classList.add("active");
      document.querySelector(`#${button.dataset.view}`).classList.add("active");
      renderAll();
    });
  });
}

function bindActions() {
  document.querySelector("#extractButton").addEventListener("click", () => {
    fillScores(extractScores(fields.text.value));
    setStatus("文章から点数を拾いました。");
  });

  document.querySelector("#saveButton").addEventListener("click", saveEntry);
  document.querySelector("#cancelEditButton").addEventListener("click", cancelEdit);
  document.querySelector("#importButton").addEventListener("click", () => importLog(fields.importText.value));
  fields.importFile.addEventListener("change", loadImportFile);
  document.querySelector("#exportButton").addEventListener("click", exportCsv);
  document.querySelector("#historyExportButton").addEventListener("click", exportHistoryCsv);
  document.querySelector("#deleteHistoryRangeButton").addEventListener("click", deleteHistoryRange);
  document.querySelector("#printButton").addEventListener("click", () => printView("doctor"));
  document.querySelector("#weatherButton").addEventListener("click", fetchCurrentWeather);
  document.querySelector("#saveLabelsButton").addEventListener("click", saveSymptomLabelSettings);
  document.querySelector("#resetLabelsButton").addEventListener("click", resetSymptomLabelSettings);
  document.querySelector("#reloadAppButton").addEventListener("click", reloadFreshVersion);
  document.querySelector("#clearHistoryFilterButton").addEventListener("click", clearHistoryFilters);
  fields.historyStart.addEventListener("change", renderHistory);
  fields.historyEnd.addEventListener("change", renderHistory);
  fields.historySort.addEventListener("change", renderHistory);
  document.querySelector("#historyList").addEventListener("click", event => {
    const button = event.target.closest("[data-edit-id]");
    if (button) startEdit(button.dataset.editId);
  });
  fields.doctorStart.addEventListener("change", renderDoctorReport);
  fields.doctorEnd.addEventListener("change", renderDoctorReport);
  fields.text.addEventListener("input", () => fillScores(extractScores(fields.text.value), false));
  const voiceButton = document.querySelector("#voiceButton");
  if (voiceButton) voiceButton.addEventListener("click", startVoiceInput);
  const voiceStopButton = getVoiceStopButton();
  if (voiceStopButton) voiceStopButton.addEventListener("click", stopVoiceInput);
  window.addEventListener("afterprint", clearPrintMode);

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    document.querySelector("#installButton").classList.remove("hidden");
  });
  document.querySelector("#installButton").addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    deferredInstallPrompt = null;
    document.querySelector("#installButton").classList.add("hidden");
  });
}

function printView(viewId) {
  clearPrintMode();
  document.body.classList.add(`print-${viewId}`);
  window.print();
}

function clearPrintMode() {
  document.body.classList.remove("print-doctor");
}

function renderAppVersion() {
  const version = document.querySelector("#appVersion");
  if (version) version.textContent = `バージョン ${APP_VERSION}`;
}

async function reloadFreshVersion() {
  fields.reloadStatus.textContent = "キャッシュを削除して再読み込みします。";
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
    }
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(registration => registration.unregister()));
    }
  } catch {
    fields.reloadStatus.textContent = "一部のキャッシュ削除に失敗しましたが、再読み込みします。";
  }
  const url = new URL(window.location.href);
  url.searchParams.set("version", String(Date.now()));
  window.location.replace(url.toString());
}

function loadSymptomLabels() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(LABELS_KEY) || "{}");
  } catch {
    saved = {};
  }
  return defaultSymptoms.map(symptom => ({
    ...symptom,
    label: saved[symptom.key] || symptom.label
  }));
}

function renderSettings() {
  symptoms.forEach(symptom => {
    const input = document.querySelector(`[data-setting-label="${symptom.key}"]`);
    if (input) input.value = symptom.label;
  });
}

function saveSymptomLabelSettings() {
  const labels = {};
  symptoms.forEach(symptom => {
    const input = document.querySelector(`[data-setting-label="${symptom.key}"]`);
    const label = input && input.value.trim() ? input.value.trim() : defaultSymptoms.find(item => item.key === symptom.key).label;
    symptom.label = label;
    labels[symptom.key] = label;
  });
  localStorage.setItem(LABELS_KEY, JSON.stringify(labels));
  applySymptomLabels();
  renderAll();
  fields.settingsStatus.textContent = "項目名を保存しました。";
}

function resetSymptomLabelSettings() {
  localStorage.removeItem(LABELS_KEY);
  symptoms.forEach(symptom => {
    const standard = defaultSymptoms.find(item => item.key === symptom.key);
    symptom.label = standard.label;
  });
  renderSettings();
  applySymptomLabels();
  renderAll();
  fields.settingsStatus.textContent = "標準の項目名に戻しました。";
}

function applySymptomLabels() {
  symptoms.forEach(symptom => {
    document.querySelectorAll(`[data-symptom-label="${symptom.key}"]`).forEach(element => {
      element.textContent = symptom.label;
    });
  });
  updateHistorySortLabels();
}

function updateHistorySortLabels() {
  symptoms.forEach(symptom => {
    const desc = fields.historySort.querySelector(`option[value="${symptom.key}Desc"]`);
    const asc = fields.historySort.querySelector(`option[value="${symptom.key}Asc"]`);
    if (desc) desc.textContent = `${symptom.label} 高い順`;
    if (asc) asc.textContent = `${symptom.label} 低い順`;
  });
}

function saveEntry() {
  const text = fields.text.value.trim();
  if (!text) {
    setStatus("メモを入力してください。");
    return;
  }
  const scores = readScores();
  const entry = {
    id: editingEntryId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    date: new Date(fields.date.value || Date.now()).toISOString(),
    text,
    weather: fields.weather.value.trim(),
    tempHigh: fields.tempHigh.value === "" ? null : Number(fields.tempHigh.value),
    tempLow: fields.tempLow.value === "" ? null : Number(fields.tempLow.value),
    scores
  };
  if (editingEntryId) {
    entries = entries.map(item => item.id === editingEntryId ? entry : item);
  } else {
    entries.push(entry);
  }
  entries = sortEntries(dedupeEntries(entries));
  saveEntries();
  resetEntryForm();
  setStatus(editingEntryId ? "訂正を保存しました。" : "保存しました。");
  editingEntryId = null;
  updateEditMode();
  renderAll();
}

function getVoiceStopButton() {
  let stopButton = document.querySelector("#voiceStopButton");
  if (!stopButton) {
    const voiceButton = document.querySelector("#voiceButton");
    if (!voiceButton) return null;
    stopButton = document.createElement("button");
    stopButton.type = "button";
    stopButton.id = "voiceStopButton";
    stopButton.textContent = "停止";
    stopButton.className = voiceButton.className;
    stopButton.classList.remove("primary");
    stopButton.classList.add("danger");
    stopButton.setAttribute("aria-label", "音声入力を停止");
    voiceButton.insertAdjacentElement("afterend", stopButton);
  }
  return stopButton;
}

function setVoiceButtonState(listening) {
  const voiceButton = document.querySelector("#voiceButton");
  const stopButton = getVoiceStopButton();
  const banner = document.querySelector("#voiceBanner");
  if (voiceButton) {
    voiceButton.textContent = listening ? "音声入力中" : "音声入力";
    voiceButton.disabled = listening;
    voiceButton.classList.toggle("primary", !listening);
  }
  if (stopButton) {
    stopButton.hidden = !listening;
    stopButton.classList.toggle("hidden", !listening);
    stopButton.disabled = !listening;
  }
  if (banner) {
    banner.classList.toggle("hidden", !listening);
    banner.textContent = listening ? "録音中  停止するまで待機します" : "録音中";
  }
}

function stopVoiceInput() {
  keepVoiceListening = false;
  stopVoiceRequested = true;
  if (voiceRestartTimer) {
    clearTimeout(voiceRestartTimer);
    voiceRestartTimer = null;
  }
  if (!activeRecognition) {
    setVoiceButtonState(false);
    setStatus("音声入力を停止しました。必要なら保存してください。");
    return;
  }
  setStatus("音声入力を停止しています。");
  try {
    activeRecognition.stop();
  } catch (_) {
    try { activeRecognition.abort(); } catch (_) {}
  }
}

function startVoiceInput() {
  if (activeRecognition) return;
  if (voiceRestartTimer) {
    clearTimeout(voiceRestartTimer);
    voiceRestartTimer = null;
  }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    setStatus("このブラウザでは音声入力が使えません。iPhoneのキーボードのマイクボタンでも入力できます。");
    fields.text.focus();
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = "ja-JP";
  recognition.interimResults = true;
  recognition.continuous = false;

  // 既存テキストを一度だけ確定し、認識結果は resultIndex ではなく結果番号ごとに上書きして重複を防ぐ。
  const baseText = fields.text.value;
  const separator = baseText && !baseText.endsWith("\n") ? "\n" : "";
  const finalSegments = [];
  let finalText = "";

  const compose = (interim) => {
    const spoken = cleanSpeechText(finalText + interim).trim();
    fields.text.value = spoken ? baseText + separator + spoken : baseText;
    fillScores(extractScores(fields.text.value), false);
  };

  recognition.onresult = event => {
    let interim = "";
    for (let i = 0; i < event.results.length; i += 1) {
      const transcript = cleanSpeechText(event.results[i][0].transcript);
      if (event.results[i].isFinal) {
        finalSegments[i] = transcript;
      } else if (i >= event.resultIndex) {
        interim += transcript;
      }
    }
    finalText = finalSegments.filter(Boolean).join("");
    compose(interim);
  };
  recognition.onerror = e => {
    if (e && e.error === "no-speech") return;
    const fatalErrors = ["not-allowed", "service-not-allowed", "audio-capture", "network"];
    if (e && fatalErrors.includes(e.error)) {
      keepVoiceListening = false;
      stopVoiceRequested = true;
      setVoiceButtonState(false);
      setStatus("音声入力を開始できませんでした。ChromeではHTTPSまたはlocalhost、マイク許可が必要です。");
      return;
    }
    setStatus("音声入力でエラーが発生しました。もう一度待機します。停止する時は停止を押してください。");
  };
  recognition.onend = () => {
    const wasStopped = stopVoiceRequested;
    activeRecognition = null;
    compose("");
    if (keepVoiceListening && !wasStopped) {
      setVoiceButtonState(true);
      setStatus("音声入力を継続待機中です。停止を押すまで自動で再開します。");
      voiceRestartTimer = setTimeout(() => {
        voiceRestartTimer = null;
        if (keepVoiceListening && !activeRecognition) startVoiceInput();
      }, 200);
      return;
    }
    stopVoiceRequested = false;
    keepVoiceListening = false;
    setVoiceButtonState(false);
    setStatus(wasStopped ? "音声入力を停止しました。必要なら保存してください。" : "音声入力が終わりました。必要なら保存してください。");
  };

  activeRecognition = recognition;
  stopVoiceRequested = false;
  keepVoiceListening = true;
  setVoiceButtonState(true);
  setStatus("録音中です。停止を押すまで継続します。");
  try {
    recognition.start();
  } catch (_) {
    activeRecognition = null;
    stopVoiceRequested = false;
    keepVoiceListening = false;
    setVoiceButtonState(false);
    setStatus("音声入力を開始できませんでした。マイク許可やブラウザの制限を確認してください。");
  }
}

function cleanSpeechText(value) {
  let text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  text = collapseKnownRepeatedTerms(text);
  return collapseExactRepeatedText(text);
}

function collapseKnownRepeatedTerms(value) {
  const terms = symptoms
    .flatMap(symptom => [symptom.label, ...symptom.aliases])
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  return terms.reduce((text, term) => {
    const escaped = escapeRegExp(term);
    return text.replace(new RegExp(`${escaped}(?:\\s*${escaped})+`, "g"), term);
  }, value);
}

function collapseExactRepeatedText(value) {
  const compact = value.replace(/\s+/g, "");
  for (let size = 1; size <= Math.floor(compact.length / 2); size += 1) {
    if (compact.length % size !== 0) continue;
    const part = compact.slice(0, size);
    if (part && part.repeat(compact.length / size) === compact) return part;
  }
  return value;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fetchCurrentWeather() {
  if (!navigator.geolocation) {
    setStatus("この端末では位置情報を使えません。天気と気温は手入力してください。");
    return;
  }
  setStatus("今日の天気と最高・最低気温を取得しています。");
  try {
    const position = await getCurrentPosition();
    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;
    const data = await fetchWeatherForecast(latitude, longitude);
    const hourlyCodes = data.hourly && data.hourly.weather_code ? data.hourly.weather_code : [];
    const dailyCode = data.daily && data.daily.weather_code ? data.daily.weather_code[0] : null;
    fields.weather.value = summarizeDailyWeather(hourlyCodes) || weatherCodeToJapanese(dailyCode);
    fields.tempHigh.value = formatTemperature(data.daily && data.daily.temperature_2m_max ? data.daily.temperature_2m_max[0] : null);
    fields.tempLow.value = formatTemperature(data.daily && data.daily.temperature_2m_min ? data.daily.temperature_2m_min[0] : null);
    setStatus("今日の天気と最高・最低気温を入れました。");
  } catch (error) {
    setStatus(`天気を取得できませんでした。位置情報の許可、HTTPS、ネット接続を確認してください。${error && error.message ? ` (${error.message})` : ""}`);
  }
}

async function fetchWeatherForecast(latitude, longitude) {
  const params = `latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=Asia%2FTokyo`;
  const detailedUrl = `https://api.open-meteo.com/v1/forecast?${params}&hourly=weather_code`;
  try {
    const response = await fetch(detailedUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (_) {
    const fallbackUrl = `https://api.open-meteo.com/v1/forecast?${params}`;
    const response = await fetch(fallbackUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  }
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 25000,
      maximumAge: 10 * 60 * 1000
    });
  });
}

function weatherCodeToJapanese(code) {
  const labels = {
    0: "快晴",
    1: "ほぼ晴れ",
    2: "やや曇り",
    3: "曇り",
    45: "霧",
    48: "霧氷",
    51: "弱い霧雨",
    53: "霧雨",
    55: "強い霧雨",
    56: "弱い着氷性霧雨",
    57: "着氷性霧雨",
    61: "弱い雨",
    63: "雨",
    65: "強い雨",
    66: "弱い着氷性雨",
    67: "着氷性雨",
    71: "弱い雪",
    73: "雪",
    75: "強い雪",
    77: "雪粒",
    80: "弱いにわか雨",
    81: "にわか雨",
    82: "強いにわか雨",
    85: "弱いにわか雪",
    86: "にわか雪",
    95: "雷雨",
    96: "雷雨と弱いひょう",
    99: "雷雨と強いひょう"
  };
  return labels[code] || "";
}

function summarizeDailyWeather(codes) {
  const labels = codes.map(weatherCodeToSimpleLabel).filter(Boolean);
  if (!labels.length) return "";
  const transitions = [];
  labels.forEach(label => {
    if (transitions[transitions.length - 1] !== label) transitions.push(label);
  });
  const mainTransitions = transitions.filter((label, index) => index === 0 || label !== transitions[index - 1]);
  let summary = mainTransitions.slice(0, 3).join("のち");
  const rainCount = labels.filter(label => label === "雨" || label === "雪").length;
  const rainLabel = labels.includes("雪") ? "雪" : "雨";
  if (rainCount > 0 && rainCount <= 3 && !summary.includes(rainLabel)) {
    summary += `、一時${rainLabel}`;
  }
  return summary;
}

function weatherCodeToSimpleLabel(code) {
  if ([0, 1].includes(code)) return "晴れ";
  if ([2, 3, 45, 48].includes(code)) return "曇り";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code)) return "雨";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "雪";
  return weatherCodeToJapanese(code);
}

function formatTemperature(value) {
  return Number.isFinite(value) ? String(Math.round(value * 10) / 10) : "";
}

function importLog(raw) {
  const parsed = parseImportedData(raw);
  if (!parsed.length) {
    setStatus("取り込める日付つきログが見つかりませんでした。");
    return;
  }
  entries = sortEntries(dedupeEntries([...entries, ...parsed]));
  saveEntries();
  setStatus(`${parsed.length}件を取り込みました。`);
  renderAll();
}

function parseImportedData(raw) {
  const text = String(raw || "").trim();
  if (looksLikeTableCsv(text)) return parseHealthCsv(text);
  return parseLog(text);
}

function looksLikeTableCsv(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  return firstLine.includes("日付") && firstLine.includes("時間") && firstLine.includes("頭痛");
}

function loadImportFile() {
  const file = fields.importFile.files && fields.importFile.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    fields.importText.value = String(reader.result || "");
    setStatus(`${file.name} を読み込みました。「取り込む」を押してください。`);
  };
  reader.onerror = () => setStatus("ファイルを読み込めませんでした。");
  reader.readAsText(file, "utf-8");
}

function parseLog(raw) {
  const text = String(raw || "").replace(/\r/g, "").trim();
  const dateRegex = /(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/g;
  const matches = [...text.matchAll(dateRegex)];
  const parsed = [];

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const start = match.index + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const body = text.slice(start, end).trim();
    const previous = text.slice(i === 0 ? 0 : matches[i - 1].index + matches[i - 1][0].length, match.index).trim();
    const firstLines = body.split("\n").map(line => line.trim()).filter(Boolean);
    const weatherLine = firstLines[0] && /°C|℃|晴|曇|雨|霧/.test(firstLines[0]) ? firstLines.shift() : "";
    const memo = firstLines.join("\n").trim() || previous.replace(/^体調ログ\s*/u, "").trim();
    const weather = weatherLine.replace(/\s*-?\d+\s*°?\s*C|℃/i, "").trim();
    const tempMatch = weatherLine.match(/(-?\d+)\s*°?\s*C|(-?\d+)\s*℃/i);
    parsed.push({
      id: `import-${match[0]}-${i}`,
      date: new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])).toISOString(),
      text: memo,
      weather,
      temperature: tempMatch ? Number(tempMatch[1] || tempMatch[2]) : null,
      scores: extractScores(`${memo}\n${previous}`)
    });
  }
  return parsed;
}

function parseHealthCsv(raw) {
  const rows = parseCsvRows(raw).filter(row => row.some(cell => String(cell).trim() !== ""));
  if (rows.length < 2) return [];
  const header = rows[0].map(cell => cell.trim());
  const index = name => header.findIndex(cell => cell === name);
  const columns = {
    date: index("日付"),
    time: index("時間"),
    weather: index("天気・気温"),
    headache: index("頭痛"),
    tinnitus: index("耳鳴り"),
    back: index("腰"),
    leg: index("足"),
    other: index("その他症状"),
    note: index("活動・通院の備考")
  };
  if (columns.date < 0) return [];
  return rows.slice(1).map((row, rowIndex) => {
    const date = parseCsvDate(row[columns.date], row[columns.time]);
    const weatherInfo = parseWeatherAndTemperature(row[columns.weather]);
    const otherText = row[columns.other] || "";
    const noteText = row[columns.note] || "";
    const scores = {
      headache: parseScoreCell(row[columns.headache]),
      tinnitus: parseScoreCell(row[columns.tinnitus]),
      back: parseScoreCell(row[columns.back]),
      leg: parseScoreCell(row[columns.leg])
    };
    const otherScores = extractScores(otherText);
    Object.entries(otherScores).forEach(([key, value]) => {
      if (scores[key] == null) scores[key] = value;
    });
    Object.keys(scores).forEach(key => {
      if (!Number.isFinite(scores[key])) delete scores[key];
    });
    return {
      id: `csv-${date.toISOString()}-${rowIndex}`,
      date: date.toISOString(),
      text: [otherText, noteText].map(value => value.trim()).filter(Boolean).join("\n") || "CSVから取り込み",
      weather: weatherInfo.weather,
      tempHigh: weatherInfo.tempHigh,
      tempLow: weatherInfo.tempLow,
      temperature: weatherInfo.temperature,
      scores
    };
  });
}

function parseCsvRows(raw) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const text = String(raw || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function parseCsvDate(dateValue, timeValue) {
  const dateText = toHalfWidth(String(dateValue || ""));
  const match = dateText.match(/(\d{1,2})\/(\d{1,2})/);
  const year = new Date().getFullYear();
  const month = match ? Number(match[1]) : new Date().getMonth() + 1;
  const day = match ? Number(match[2]) : new Date().getDate();
  const hour = csvTimeToHour(timeValue);
  return new Date(year, month - 1, day, hour, 0, 0, 0);
}

function csvTimeToHour(value) {
  const text = String(value || "");
  if (text.includes("朝")) return 8;
  if (text.includes("昼")) return 12;
  if (text.includes("午後")) return 15;
  if (text.includes("夕方")) return 17;
  if (text.includes("夜")) return 21;
  return 12;
}

function parseWeatherAndTemperature(value) {
  const text = String(value || "").trim();
  const tempMatch = toHalfWidth(text).match(/(-?\d+(?:\.\d+)?)\s*°?\s*C|(-?\d+(?:\.\d+)?)\s*℃/i);
  const temperature = tempMatch ? Number(tempMatch[1] || tempMatch[2]) : null;
  const weather = text.replace(/-?\d+(?:\.\d+)?\s*°?\s*C|-?\d+(?:\.\d+)?\s*℃/ig, "").replace(/[・、,\s]+$/u, "").trim();
  return { weather, temperature, tempHigh: temperature, tempLow: null };
}

function parseScoreCell(value) {
  const text = toHalfWidth(String(value || "").trim());
  if (!text || /記録なし|なし|[-ー―]/.test(text)) return null;
  const match = text.match(/([0-9]|10)/);
  return match ? Number(match[1]) : null;
}

function extractScores(text) {
  const normalized = toHalfWidth(String(text || "")).replace(/\s+/g, "");
  const scores = {};
  symptoms.forEach(symptom => {
    for (const alias of symptom.aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = normalized.match(new RegExp(`${escaped}(?:が|は|の痛み|のしびれ|も|後|に)?[:：]?([0-9]|10)`, "u"));
      if (match) {
        scores[symptom.key] = Number(match[1]);
        break;
      }
    }
  });
  if (scores.sleep == null && /眠れない|寝れない|寝づらい|眠りが浅い/.test(normalized)) scores.sleep = 7;
  return scores;
}

function fillScores(scores, overwrite = true) {
  Object.entries(scores).forEach(([key, value]) => {
    if (scoreInputs[key] && (overwrite || !scoreInputs[key].value)) scoreInputs[key].value = value;
  });
}

function readScores() {
  const scores = {};
  Object.entries(scoreInputs).forEach(([key, input]) => {
    if (input.value !== "") scores[key] = Number(input.value);
  });
  return scores;
}

function renderAll() {
  renderRecent();
  renderHistory();
  renderDoctorReport();
}

function renderRecent() {
  const recent = [...entries].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);
  document.querySelector("#recentList").innerHTML = recent.map(renderEntry).join("") || emptyText("まだ記録がありません。");
}

function renderHistory() {
  const filtered = getHistoryEntries();
  document.querySelector("#historyCount").textContent = `${filtered.length}件を表示中`;
  document.querySelector("#historyList").innerHTML = filtered.map(renderHistoryEntry).join("") || emptyText("条件に合う記録はありません。");
}

function getHistoryEntries() {
  let filtered = [...entries];
  if (fields.historyStart.value) {
    const start = dateInputToLocalStart(fields.historyStart.value);
    filtered = filtered.filter(entry => new Date(entry.date) >= start);
  }
  if (fields.historyEnd.value) {
    const end = dateInputToLocalEnd(fields.historyEnd.value);
    filtered = filtered.filter(entry => new Date(entry.date) <= end);
  }
  return sortHistoryEntries(filtered);
}

function clearHistoryFilters() {
  fields.historyStart.value = "";
  fields.historyEnd.value = "";
  fields.historySort.value = "dateDesc";
  renderHistory();
}

function deleteHistoryRange() {
  if (!fields.deleteStart.value || !fields.deleteEnd.value) {
    setStatus("削除するには、入力タブ下の開始日と終了日を指定してください。");
    return;
  }
  let start = dateInputToLocalStart(fields.deleteStart.value);
  let end = dateInputToLocalEnd(fields.deleteEnd.value);
  if (start > end) {
    const previousStart = fields.deleteStart.value;
    fields.deleteStart.value = fields.deleteEnd.value;
    fields.deleteEnd.value = previousStart;
    start = dateInputToLocalStart(fields.deleteStart.value);
    end = dateInputToLocalEnd(fields.deleteEnd.value);
  }
  const targetEntries = entries.filter(entry => {
    const date = new Date(entry.date);
    return date >= start && date <= end;
  });
  if (!targetEntries.length) {
    setStatus("指定範囲に削除できる記録はありません。");
    return;
  }
  const message = `${formatDateOnly(start)} から ${formatDateOnly(end)} までの ${targetEntries.length}件を削除します。よろしいですか？`;
  if (!window.confirm(message)) return;
  const targetIds = new Set(targetEntries.map(entry => entry.id));
  entries = entries.filter(entry => !targetIds.has(entry.id));
  saveEntries();
  if (editingEntryId && targetIds.has(editingEntryId)) {
    editingEntryId = null;
    resetEntryForm();
    updateEditMode();
  }
  setStatus(`${targetEntries.length}件を削除しました。`);
  renderAll();
}

function sortHistoryEntries(items) {
  const sortValue = fields.historySort.value || "dateDesc";
  if (sortValue === "dateAsc") return items.sort((a, b) => new Date(a.date) - new Date(b.date));
  if (sortValue === "dateDesc") return items.sort((a, b) => new Date(b.date) - new Date(a.date));

  const match = sortValue.match(/^(.+?)(Asc|Desc)$/);
  if (!match) return items.sort((a, b) => new Date(b.date) - new Date(a.date));
  const [, key, direction] = match;
  return items.sort((a, b) => {
    const aHasValue = Number.isFinite(a.scores[key]);
    const bHasValue = Number.isFinite(b.scores[key]);
    if (!aHasValue && !bHasValue) return new Date(b.date) - new Date(a.date);
    if (!aHasValue) return 1;
    if (!bHasValue) return -1;
    const aValue = a.scores[key];
    const bValue = b.scores[key];
    const diff = direction === "Asc" ? aValue - bValue : bValue - aValue;
    return diff || new Date(b.date) - new Date(a.date);
  });
}

function renderHistoryEntry(entry) {
  return `<article class="log-item">
    <div class="log-meta"><span>${formatDate(entry.date)}</span><span>${escapeHtml(formatWeatherMeta(entry))}</span></div>
    <div>${escapeHtml(entry.text)}</div>
    <div class="chips">${scoreChips(entry.scores)}</div>
    <div class="log-actions">
      <button type="button" data-edit-id="${escapeHtml(entry.id)}">訂正</button>
    </div>
  </article>`;
}

function startEdit(id) {
  const entry = entries.find(item => item.id === id);
  if (!entry) return;
  editingEntryId = id;
  fields.date.value = toLocalInputValue(new Date(entry.date));
  fields.weather.value = entry.weather || "";
  fields.tempHigh.value = entry.tempHigh ?? entry.temperature ?? "";
  fields.tempLow.value = entry.tempLow ?? "";
  fields.text.value = entry.text || "";
  Object.entries(scoreInputs).forEach(([key, input]) => {
    input.value = entry.scores && Number.isFinite(entry.scores[key]) ? entry.scores[key] : "";
  });
  updateEditMode();
  switchView("entry");
  setStatus("過去記録を訂正中です。内容を直して「訂正を保存」を押してください。");
}

function cancelEdit() {
  editingEntryId = null;
  resetEntryForm();
  updateEditMode();
  setStatus("訂正をやめました。");
}

function resetEntryForm() {
  fields.text.value = "";
  fields.weather.value = "";
  fields.tempHigh.value = "";
  fields.tempLow.value = "";
  Object.values(scoreInputs).forEach(input => input.value = "");
  fields.date.value = toLocalInputValue(new Date());
}

function updateEditMode() {
  document.querySelector("#saveButton").textContent = editingEntryId ? "訂正を保存" : "保存";
  document.querySelector("#cancelEditButton").classList.toggle("hidden", !editingEntryId);
}

function switchView(viewId) {
  document.querySelectorAll(".tab, .view").forEach(el => el.classList.remove("active"));
  document.querySelector(`.tab[data-view="${viewId}"]`).classList.add("active");
  document.querySelector(`#${viewId}`).classList.add("active");
}

function renderDoctorReport() {
  const range = getDoctorRange();
  const reportEntries = entries.filter(entry => {
    const date = new Date(entry.date);
    return date >= range.start && date <= range.end;
  });
  const strongDays = reportEntries.filter(entry => Object.values(entry.scores).some(value => value >= 6));
  document.querySelector("#doctorReport").innerHTML = `
    <div class="report-heading">
      <h2>${formatDateOnly(range.start)} - ${formatDateOnly(range.end)} 体調推移</h2>
      <p>記録回数：${reportEntries.length}回</p>
    </div>
    <canvas id="doctorChart" class="doctor-chart" width="1600" height="780" aria-label="受診用の横長線グラフ"></canvas>
    <h2>強かった日・気になるメモ</h2>
    <table class="report-table">
      <thead><tr><th>日時</th><th>点数</th><th>メモ</th></tr></thead>
      <tbody>${(strongDays.length ? strongDays : reportEntries.slice(-8)).map(entry => `
        <tr>
          <td>${formatDate(entry.date)}</td>
          <td>${scoreChips(entry.scores, " / ")}</td>
          <td>${escapeHtml(entry.text)}</td>
        </tr>`).join("")}</tbody>
    </table>
  `;
  drawChart(reportEntries, "#doctorChart");
}

function drawChart(monthEntries, selector = "#chart") {
  const canvas = document.querySelector(selector);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const pad = { left: 54, right: 24, top: 28, bottom: 52 };
  const width = canvas.width - pad.left - pad.right;
  const height = canvas.height - pad.top - pad.bottom;
  ctx.strokeStyle = "#ded7cc";
  ctx.lineWidth = 1;
  ctx.font = "18px sans-serif";
  ctx.fillStyle = "#746b60";
  for (let i = 0; i <= 10; i += 2) {
    const y = pad.top + height - (i / 10) * height;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(canvas.width - pad.right, y);
    ctx.stroke();
    ctx.fillText(String(i), 18, y + 6);
  }
  if (!monthEntries.length) {
    ctx.fillText("この期間の記録はありません", pad.left, pad.top + 40);
    return;
  }
  const sorted = [...monthEntries].sort((a, b) => new Date(a.date) - new Date(b.date));
  const xFor = index => pad.left + (sorted.length === 1 ? width / 2 : (index / (sorted.length - 1)) * width);
  const chartSymptoms = symptoms.slice(0, 5);
  chartSymptoms.forEach((symptom, symptomIndex) => {
    const points = sorted.map((entry, index) => {
      const value = entry.scores[symptom.key];
      const overlapOffset = Number.isFinite(value) ? getOverlapOffset(entry, chartSymptoms, symptomIndex, value) : 0;
      return Number.isFinite(value)
        ? { x: xFor(index), y: pad.top + height - (value / 10) * height + overlapOffset, hasValue: true }
        : { x: xFor(index), y: null, hasValue: false };
    });
    if (!points.length) return;
    ctx.strokeStyle = symptom.color;
    ctx.fillStyle = symptom.color;
    ctx.lineWidth = 4;
    let segmentStarted = false;
    ctx.beginPath();
    points.forEach(point => {
      if (!point.hasValue) {
        segmentStarted = false;
        return;
      }
      if (segmentStarted) ctx.lineTo(point.x, point.y);
      else ctx.moveTo(point.x, point.y);
      segmentStarted = true;
    });
    ctx.stroke();
    points.filter(point => point.hasValue).forEach(point => {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
      ctx.fill();
    });
  });
  const legendY = canvas.height - 20;
  drawDateLabels(ctx, sorted, xFor, pad, height, legendY);
  chartSymptoms.forEach((symptom, index) => {
    const x = pad.left + index * 145;
    ctx.fillStyle = symptom.color;
    ctx.fillRect(x, legendY - 12, 18, 8);
    ctx.fillStyle = "#24211c";
    ctx.fillText(symptom.label, x + 26, legendY);
  });
}

function getOverlapOffset(entry, chartSymptoms, symptomIndex, value) {
  const sameValueSymptoms = chartSymptoms
    .map((symptom, index) => ({ index, value: entry.scores[symptom.key] }))
    .filter(item => item.value === value);
  if (sameValueSymptoms.length <= 1) return 0;
  const position = sameValueSymptoms.findIndex(item => item.index === symptomIndex);
  const center = (sameValueSymptoms.length - 1) / 2;
  return (position - center) * 8;
}

function drawDateLabels(ctx, sorted, xFor, pad, height, legendY) {
  ctx.save();
  ctx.strokeStyle = "#bdb5aa";
  ctx.fillStyle = "#24211c";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  ctx.font = "16px sans-serif";
  ctx.textAlign = "center";
  const usedDays = new Set();
  sorted.forEach((entry, index) => {
    const date = new Date(entry.date);
    const key = toDateInputValue(date);
    if (date.getDay() !== 0 || usedDays.has(key)) return;
    usedDays.add(key);
    const x = xFor(index);
    const y = pad.top + height;
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, y + 8);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(`${date.getMonth() + 1}/${date.getDate()}`, x, Math.min(y + 28, legendY - 18));
    ctx.setLineDash([6, 6]);
  });
  ctx.restore();
}

function renderEntry(entry) {
  return `<article class="log-item">
    <div class="log-meta"><span>${formatDate(entry.date)}</span><span>${escapeHtml(formatWeatherMeta(entry))}</span></div>
    <div>${escapeHtml(entry.text)}</div>
    <div class="chips">${scoreChips(entry.scores)}</div>
  </article>`;
}

function formatWeatherMeta(entry) {
  const temperatures = [];
  if (entry.tempHigh != null) temperatures.push(`最高${entry.tempHigh}°C`);
  if (entry.tempLow != null) temperatures.push(`最低${entry.tempLow}°C`);
  if (!temperatures.length && entry.temperature != null) temperatures.push(`${entry.temperature}°C`);
  return [entry.weather, temperatures.join(" / ")].filter(Boolean).join(" ");
}

function scoreChips(scores, separator = "") {
  const items = symptoms.filter(symptom => Number.isFinite(scores[symptom.key])).map(symptom => `${symptom.label}${scores[symptom.key]}`);
  if (separator) return items.join(separator) || "-";
  return items.map(item => `<span class="chip">${item}</span>`).join("") || `<span class="chip">点数なし</span>`;
}

function exportCsv() {
  downloadEntriesCsv(entries, `体調ログ_${new Date().toISOString().slice(0, 10)}.csv`);
}

function exportHistoryCsv() {
  const filtered = getHistoryEntries();
  downloadEntriesCsv(filtered, `過去記録_${new Date().toISOString().slice(0, 10)}.csv`);
}

function downloadEntriesCsv(targetEntries, filename) {
  const header = ["日時", "天気", "最高気温", "最低気温", ...symptoms.map(s => s.label), "メモ"];
  const rows = targetEntries.map(entry => [
    formatDate(entry.date), entry.weather, entry.tempHigh ?? entry.temperature ?? "", entry.tempLow ?? "",
    ...symptoms.map(symptom => entry.scores[symptom.key] ?? ""),
    entry.text
  ]);
  const csv = [header, ...rows].map(row => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function loadEntries() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveEntries() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function dedupeEntries(items) {
  const seen = new Set();
  return items.filter(entry => {
    const key = `${entry.date}|${entry.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortEntries(items) {
  return [...items].sort((a, b) => new Date(a.date) - new Date(b.date));
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatNumber(value) {
  return value == null ? "-" : value.toFixed(1);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function setDefaultDoctorRange() {
  const month = currentMonth();
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(year, monthNumber - 1, 1);
  const end = new Date(year, monthNumber, 0);
  fields.doctorStart.value = toDateInputValue(start);
  fields.doctorEnd.value = toDateInputValue(end);
}

function getDoctorRange() {
  if (!fields.doctorStart.value || !fields.doctorEnd.value) setDefaultDoctorRange();
  let start = dateInputToLocalStart(fields.doctorStart.value);
  let end = dateInputToLocalEnd(fields.doctorEnd.value);
  if (start > end) {
    const previousStart = fields.doctorStart.value;
    fields.doctorStart.value = fields.doctorEnd.value;
    fields.doctorEnd.value = previousStart;
    start = dateInputToLocalStart(fields.doctorStart.value);
    end = dateInputToLocalEnd(fields.doctorEnd.value);
  }
  return { start, end };
}

function toLocalInputValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function toDateInputValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function dateInputToLocalStart(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function dateInputToLocalEnd(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

function formatDateOnly(value) {
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" }).format(new Date(value));
}

function toHalfWidth(value) {
  return value.replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0));
}

function emptyText(text) {
  return `<p class="status">${text}</p>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function setStatus(message) {
  fields.status.textContent = message;
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => {});
}
