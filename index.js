/* ---------- LOGGING UTILITY ---------- */
const IS_PRODUCTION = false; // Set to true for competition day

const Logger = {
    info: (msg, data) => !IS_PRODUCTION && console.log(`[INFO] ${new Date().toISOString()} - ${msg}`, data || ''),
    warn: (msg, data) => console.warn(`[WARN] ${new Date().toISOString()} - ${msg}`, data || ''),
    error: (msg, data) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`, data || ''),
    debug: (msg, data) => !IS_PRODUCTION && console.log(`[DEBUG] ${new Date().toISOString()} - ${msg}`, data || ''),
    trace: (fn, action, data) => !IS_PRODUCTION && console.log(`[TRACE] ${new Date().toISOString()} - ${fn}() - ${action}`, data || '')
};

/* ---------- CONFIG ---------- */
const API_BASE = "https://script.google.com/macros/s/AKfycbz0SY_zf_8wngrS4I03F5LwTWN9M0e59Jt4y7GQX9JHvBhWH82RdYGlHkZbESPemoXjwg/exec";
const PROXY = "https://api.allorigins.win/raw?url=";

Logger.info("Application initialized", { API_BASE });

/* ---------- Helpers ---------- */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const num = v => {
    if (v == null || v === "") return 0;
    let s = String(v).trim();
    s = s.replace(/[^\d.\-]/g, "");
    const n = parseFloat(s);
    const result = isFinite(n) ? n : 0;
    Logger.trace("num", "Converting value", { input: v, output: result });
    return result;
};

let state = { 
    participants: [], 
    committees: [], 
    role: null, 
    committee: null, 
    selParticipant: null, 
    grades: [], 
    currentQuestion: 1,
    availableParticipants: [],
    currentParticipantIndex: 0
};

/* ---------- API (CORS Safe) ---------- */
async function apiGet(action, params = {}) {
    Logger.info(`API GET request: ${action}`, params);
    const url = new URL(API_BASE);
    url.searchParams.set("action", action);
    for (const k in params) url.searchParams.set(k, params[k]);

    let fetchUrl = url.toString();

    if (location.protocol === "file:") {
        Logger.warn("Local file detected — routing through proxy");
        fetchUrl = PROXY + encodeURIComponent(url.toString());
    }

    try {
        const res = await fetch(fetchUrl, { mode: "cors" });
        const text = await res.text();
        try {
            const data = JSON.parse(text);
            Logger.info(`API GET response: ${action}`, { ok: data.ok });
            return data;
        } catch {
            Logger.error("Failed to parse JSON response", { text });
            return { ok: false, error: "Invalid JSON from server" };
        }
    } catch (error) {
        Logger.error(`API GET failed: ${action}`, { error: error.message });
        return { ok: false, error: error.message };
    }
}

async function apiPost(data = {}) {
  try {
    const res = await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      throw new Error(`Network error: ${res.status}`);
    }

    return await res.json();
  } catch (err) {
    console.error("API POST error:", err);
    return { ok: false, error: String(err) };
  }
}



/* ---------- Boot ---------- */
(async function boot() {
    Logger.info("Application booting...");
    try {
        await refreshAll();
        buildCommitteeSelects();
        wireUI();
        Logger.info("Application boot complete");
    } catch (e) {
        Logger.error("Boot failed", e);
        alert("فشل تحميل التطبيق. تحقق من الاتصال.");
    }
})();

async function refreshAll() {
    Logger.trace('refreshAll', 'Starting data refresh');
    
    const cResp = await apiGet("committees");
    state.committees = cResp.ok ? (cResp.committees || cResp.data || []) : [];
    Logger.info('Committees loaded', { count: state.committees.length });

    const pResp = await apiGet("participants");
    state.participants = pResp.ok ? (pResp.participants || pResp.data || []) : [];
    Logger.info('Participants loaded', { count: state.participants.length });
}

/* ---------- Build selects ---------- */
function buildCommitteeSelects() {
    Logger.trace('buildCommitteeSelects', 'Building committee dropdowns');
    const sel = $("#committeeSelect");
    if (!sel) return Logger.warn("No #committeeSelect found");
    
    sel.innerHTML = state.committees
        .filter(c => c.Committee !== 'admin')
        .map(c => `<option value="${c.Committee}">${c.Committee}</option>`)
        .join("");
    $("#new_committee").innerHTML = sel.innerHTML;
    $("#pw_commit_select").innerHTML = sel.innerHTML;
    $("#admCommitteeFilter").innerHTML = '<option value="">الكل</option>' + 
        state.committees
            .filter(c => c.Committee !== 'admin')
            .map(c => `<option value="${c.Committee}">اللجنة ${c.Committee}</option>`)
            .join("");
    Logger.info('Committee selects built', { committeeCount: state.committees.length });
}

/* ---------- Logout ---------- */
function logout() {
    Logger.info('User logging out', { role: state.role, committee: state.committee });
    state.role = null;
    state.committee = null;
    state.selParticipant = null;
    state.grades = [];
    state.currentQuestion = 1;
    state.availableParticipants = [];
    state.currentParticipantIndex = 0;
    
    $("#login").classList.remove("hidden");
    $("#committeeUI").classList.add("hidden");
    $("#adminUI").classList.add("hidden");
    $("#btnLogout").classList.add("hidden");
    $("#password").value = "";
    
    Logger.info('Logout complete');
}

/* ---------- Login ---------- */
$("#role").addEventListener("change", () => {
    const role = $("#role").value;
    Logger.trace('role change', 'Role changed', { role });
    $("#committeeBox").classList.toggle("hidden", role === "admin");
});

$("#btnLogin").addEventListener("click", async () => {
    Logger.trace('btnLogin', 'Login attempt started');
    const role = $("#role").value;
    const pass = $("#password").value || "";
    Logger.info('Login attempt', { role, committee: $("#committeeSelect").value });

    if (role === "admin") {
        const adminRow = state.committees.find(x => String(x.Committee).toLowerCase() === "admin");
        const expected = adminRow ? String(adminRow.Password || "") : "admin123";
        if (pass !== expected) {
            Logger.warn('Admin login failed', { reason: 'Invalid password' }); // Password removed from logs
            alert("كلمة مرور الإدارة خاطئة");
            return;
        }
        state.role = "admin";
        Logger.info('Admin login successful');
        $("#login").classList.add("hidden");
        $("#adminUI").classList.remove("hidden");
        $("#btnLogout").classList.remove("hidden");
        renderAdmin();
    } else {
        const c = $("#committeeSelect").value;
        const found = state.committees.find(x => String(x.Committee) === String(c));
        const expected = found ? String(found.Password || "") : "";
        if (pass !== expected) {
            Logger.warn('Committee login failed', { 
                committee: c, 
                reason: 'Invalid password'
                // Passwords removed from logs
            });
            alert("كلمة مرور اللجنة خاطئة");
            return;
        }
        state.role = "committee";
        state.committee = String(c);
        Logger.info('Committee login successful', { committee: c });
        $("#login").classList.add("hidden");
        $("#committeeUI").classList.remove("hidden");
        $("#btnLogout").classList.remove("hidden");
        renderCommittee();
    }
    $("#password").value = "";
});

/* ========== COMMITTEE VIEW ========== */
function renderCommittee() {
    Logger.trace('renderCommittee', 'Rendering committee view');
    buildParticipantDropdown();
    
    $("#btnRefresh").onclick = async () => {
        Logger.info('Committee refresh requested');
        await refreshAll();
        buildParticipantDropdown();
    };
    $("#btnPrev").onclick = prevQuestion;
    $("#btnNext").onclick = nextQuestion;
    $("#btnFinish").onclick = finishEvaluation;
    $("#btnPrevParticipant").onclick = prevParticipant;
    $("#btnNextParticipant").onclick = nextParticipant;
    $("#in-hifz").addEventListener("input", saveCurrentGradeLocal);
    $("#in-ada").addEventListener("input", saveCurrentGradeLocal);
    $("#in-taj").addEventListener("input", saveCurrentGradeLocal);
    
    $("#participantDropdown").addEventListener("change", (e) => {
        const selectedId = e.target.value;
        if (selectedId) {
            const participant = state.availableParticipants.find(p => p.id === selectedId);
            if (participant) {
                state.currentParticipantIndex = state.availableParticipants.indexOf(participant);
                showParticipant(participant);
            }
        } else {
            $("#card").classList.add("hidden");
        }
    });
    
    Logger.info('Committee view rendered');
}

function participantsForCommittee() {
    const participants = state.participants.filter(p => 
        String(p["اللجنة"]) === String(state.committee) && !p.submitted
    );
    Logger.debug('participantsForCommittee', { committee: state.committee, count: participants.length });
    return participants;
}

function buildParticipantDropdown() {
    Logger.trace('buildParticipantDropdown', 'Building participant dropdown');
    state.availableParticipants = participantsForCommittee();
    
    const dropdown = $("#participantDropdown");
    dropdown.innerHTML = '<option value="">-- اختر متسابقاً --</option>' +
        state.availableParticipants.map(p => 
            `<option value="${p.id}">${p["الاسم الثلاثي"] || "بدون اسم"}</option>`
        ).join("");
    
    Logger.info('Participant dropdown built', { count: state.availableParticipants.length });
    
    if (state.availableParticipants.length === 0) {
        $("#card").classList.add("hidden");
    }
}

function prevParticipant() {
    Logger.trace('prevParticipant', 'Navigating to previous participant');
    if (state.currentParticipantIndex > 0) {
        state.currentParticipantIndex--;
        const participant = state.availableParticipants[state.currentParticipantIndex];
        $("#participantDropdown").value = participant.id;
        showParticipant(participant);
        Logger.info('Moved to previous participant', { index: state.currentParticipantIndex });
    }
}

function nextParticipant() {
    Logger.trace('nextParticipant', 'Navigating to next participant');
    if (state.currentParticipantIndex < state.availableParticipants.length - 1) {
        state.currentParticipantIndex++;
        const participant = state.availableParticipants[state.currentParticipantIndex];
        $("#participantDropdown").value = participant.id;
        showParticipant(participant);
        Logger.info('Moved to next participant', { index: state.currentParticipantIndex });
    }
}

function stageConfig(parts, age) {
    const p = Number(parts) || 0;
    const tajOn = (Number(age) || 0) > 12;
    let N;
    if (p <= 1) N = 2;
    else if (p <= 10) N = Math.round(p * 2);
    else N = Math.round(p);
    const perH = 10, perA = 1, perT = tajOn ? 2 : 0;
    const perTotal = perH + perA + perT;
    const stageTotal = perTotal * N;
    const config = { N, perH, perA, perT, perTotal, stageTotal, tajOn };
    Logger.trace('stageConfig', 'Calculated stage config', { parts, age, config });
    return config;
}

async function showParticipant(p) {
    Logger.trace('showParticipant', 'Displaying participant details', { 
        participant: p.id, 
        name: p["الاسم الثلاثي"] 
    });
    state.selParticipant = p;
    $("#card").classList.remove("hidden");
    $("#d-name").textContent = p["الاسم الثلاثي"] || "—";
    $("#d-meta").textContent = `العمر: ${p["العمر"] || ""} — القسم: ${p["القسم التربوي"] || ""}`;
    const cfg = stageConfig(p["عدد الأجزاء"], p["العمر"]);
    $("#d-qcount").value = cfg.N;
    $("#taj-wrapper").classList.toggle("hidden", !cfg.tajOn);
    $("#submittedTag").classList.toggle("hidden", !!p.submitted);

    // Update navigation buttons
    $("#btnPrevParticipant").disabled = state.currentParticipantIndex === 0;
    $("#btnNextParticipant").disabled = state.currentParticipantIndex === state.availableParticipants.length - 1;

    Logger.info('Loading grades for participant', { participantId: p.id });
    const gResp = await apiGet("grades", { participant_id: p.id });
    state.grades = gResp.ok ? (gResp.grades || gResp.data || []).slice() : [];
    Logger.info('Grades loaded', { participantId: p.id, gradeCount: state.grades.length });

    for (let i = 1; i <= cfg.N; i++) {
        if (!state.grades.find(g => Number(g.question_number) === i)) {
            Logger.debug('Creating empty grade entry', { participantId: p.id, questionNumber: i });
            state.grades.push({ 
                participant_id: p.id, 
                question_number: i, 
                "حفظ": 0, 
                "أداء": 0, 
                "تجويد": 0 
            });
        }
    }
    state.grades.sort((a, b) => a.question_number - b.question_number);
    state.currentQuestion = 1;
    renderQuestion();
    updateRunningTotal();
}

function renderQuestion() {
    Logger.trace('renderQuestion', 'Rendering question', { questionNumber: state.currentQuestion });
    const cfg = stageConfig(state.selParticipant["عدد الأجزاء"], state.selParticipant["العمر"]);
    const qn = state.currentQuestion;
    const total = cfg.N;
    const g = state.grades.find(x => Number(x.question_number) === qn) || { 
        "حفظ": 0, 
        "أداء": 0, 
        "تجويد": 0 
    };

    Logger.debug('Question details', { questionNumber: qn, totalQuestions: total });

    $("#q-title").textContent = `السؤال ${qn} من ${total}`;
    $("#in-hifz").value = g["حفظ"] || 0;
    $("#in-ada").value = g["أداء"] || 0;
    $("#in-taj").value = g["تجويد"] || 0;
    $("#in-hifz").max = cfg.perH;
    $("#in-ada").max = cfg.perA;
    $("#in-taj").max = cfg.perT;
    $("#progressBar").style.width = ((qn) / total * 100) + "%";
    $("#btnPrev").disabled = (qn <= 1);
    $("#btnNext").disabled = (qn >= total);
}

function saveCurrentGradeLocal() {
    Logger.trace('saveCurrentGradeLocal', 'Saving grade', { questionNumber: state.currentQuestion });
    const qn = state.currentQuestion;
    const row = state.grades.find(x => Number(x.question_number) === qn);
    if (!row) {
        Logger.warn('Grade row not found', { questionNumber: qn });
        return;
    }

    row["حفظ"] = num($("#in-hifz").value);
    row["أداء"] = num($("#in-ada").value);
    row["تجويد"] = num($("#in-taj").value);

    Logger.info('Grade saved locally', {
        participantId: row.participant_id,
        questionNumber: qn
    });

    updateRunningTotal();

    apiPost({
        action: "add_grade",
        participant_id: row.participant_id,
        question_number: row.question_number,
        "حفظ": row["حفظ"],
        "أداء": row["أداء"],
        "تجويد": row["تجويد"]
    }).then(res => {
        Logger.info('Grade saved to server', { success: res.ok, questionNumber: qn });
    });
}

function updateRunningTotal() {
    Logger.trace('updateRunningTotal', 'Calculating running total');
    const cfg = stageConfig(state.selParticipant["عدد الأجزاء"], state.selParticipant["العمر"]);
    let H = 0, A = 0, T = 0;
    state.grades.forEach(g => {
        H += Number(g["حفظ"] || 0);
        A += Number(g["أداء"] || 0);
        if (cfg.tajOn) T += Number(g["تجويد"] || 0);
    });
    const total = Math.min(H, cfg.perH * cfg.N) + Math.min(A, cfg.perA * cfg.N) + 
                  (cfg.tajOn ? Math.min(T, cfg.perT * cfg.N) : 0);
    $("#runningTotal").value = `${total} / ${cfg.stageTotal}`;
    Logger.debug('Running total updated', { total, max: cfg.stageTotal });
}

function prevQuestion() {
    Logger.trace('prevQuestion', 'Moving to previous question');
    if (state.currentQuestion > 1) {
        state.currentQuestion--;
        Logger.info('Moved to previous question', { questionNumber: state.currentQuestion });
        renderQuestion();
    }
}

function nextQuestion() {
    Logger.trace('nextQuestion', 'Moving to next question');
    const cfg = stageConfig(state.selParticipant["عدد الأجزاء"], state.selParticipant["العمر"]);
    if (state.currentQuestion < cfg.N) {
        state.currentQuestion++;
        Logger.info('Moved to next question', { questionNumber: state.currentQuestion });
        renderQuestion();
    }
}

async function finishEvaluation() {
    Logger.trace('finishEvaluation', 'Starting evaluation finalization');
    if (!confirm("هل أنت متأكد من إنهاء التقييم؟ لن تتمكن اللجنة من تعديل العلامات بعد الإنهاء.")) {
        Logger.info('Evaluation finalization cancelled by user');
        return;
    }

    const pid = state.selParticipant.id;
    Logger.info('Finalizing participant evaluation', { participantId: pid });

    const res = await apiPost({ action: "finalize_participant", participant_id: pid });
    if (res.ok) {
        Logger.info('Evaluation finalized successfully', { participantId: pid });
        alert("تم إنهاء التقييم وحساب النتائج.");
        await refreshAll();
        buildParticipantDropdown();
    } else {
        Logger.error('Evaluation finalization failed', { participantId: pid });
        alert("فشل إنهاء التقييم: " + (res.error || ""));
    }
}

/* ========== ADMIN UI ========== */
function renderAdmin() {
    Logger.trace('renderAdmin', 'Rendering admin interface');
    $("#admRefresh").onclick = async () => {
        Logger.info('Admin refresh requested');
        await refreshAll();
        renderAdminTable();
    };
    $("#btnExport").onclick = exportXlsx;
    $("#btnAddParticipant").onclick = addParticipant;
    $("#btnSetPw").onclick = setCommitteePassword;
    $("#btnResetGrades").onclick = resetParticipantGrades;
    renderAdminTable();
    $("#pw_commit_select").value = (state.committees[0] && state.committees[0].Committee) || "";
    Logger.info('Admin interface rendered');
}

function renderAdminTable() {
    Logger.trace('renderAdminTable', 'Rendering admin table');
    const tbody = $("#adminTbody");
    tbody.innerHTML = "";

    const cFilter = $("#admCommitteeFilter").value;
    const sFilter = $("#admSubmittedFilter").value;

    Logger.debug('Admin table filters', { committeeFilter: cFilter, submittedFilter: sFilter });

    let rows = state.participants.slice();
    if (cFilter) rows = rows.filter(r => String(r["اللجنة"]) === String(cFilter));
    if (sFilter === "yes") rows = rows.filter(r => r.submitted);
    if (sFilter === "no") rows = rows.filter(r => !r.submitted);

    Logger.info('Rendering admin table', { 
        totalParticipants: state.participants.length, 
        filteredCount: rows.length 
    });

    rows.forEach((r, idx) => {
        const cfg = stageConfig(r["عدد الأجزاء"], r["العمر"]);
        const pct = cfg.stageTotal ? Math.round((r["المجموع"] || 0) / cfg.stageTotal * 10000) / 100 : 0;
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${idx + 1}</td>
            <td><input data-id="${r.id}" data-field="اللجنة" value="${r["اللجنة"] || ""}" /></td>
            <td>${r["الاسم الثلاثي"] || ""}</td>
            <td><input data-id="${r.id}" data-field="العمر" value="${r["العمر"] || ""}" /></td>
            <td><input data-id="${r.id}" data-field="عدد الأجزاء" value="${r["عدد الأجزاء"] || ""}" /></td>
            <td>${r["المجموع"] || 0}</td>
            <td>${pct}%</td>
            <td>${r["تقدير"] || ""}</td>
            <td>${r["الجائزة المالية"] || 0}</td>
            <td>${r.submitted ? (r.timestamp || "نعم") : ""}</td>
            <td>
                <button data-id="${r.id}" class="view-grades btn btn-primary">عرض</button>
                <button data-id="${r.id}" class="reset btn btn-danger">إعادة تعيين</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('input[data-id]').forEach(inp => {
        inp.addEventListener('change', async () => {
            const id = inp.dataset.id, field = inp.dataset.field, value = inp.value;
            Logger.info('Participant field update', { id, field });
            const res = await apiPost({ action: "update_participant", id: id, [field]: value });
            if (!res.ok) {
                Logger.error('Participant update failed', { id, field });
                alert("فشل الحفظ: " + (res.error || ""));
            } else {
                Logger.info('Participant updated successfully', { id, field });
                await refreshAll();
                renderAdminTable();
            }
        });
    });

    tbody.querySelectorAll('button.view-grades').forEach(b => {
        b.addEventListener('click', async () => {
            const id = b.dataset.id;
            Logger.info('Viewing grades for participant', { participantId: id });
            const g = await apiGet("grades", { participant_id: id });
            if (g.ok) {
                const grades = g.grades || g.data || [];
                Logger.debug('Grades retrieved', { participantId: id, gradeCount: grades.length });
                let s = `درجات المشارك ${id}\n\n`;
                grades.sort((a, b) => a.question_number - b.question_number)
                    .forEach(q => s += `س${q.question_number} — حفظ:${q["حفظ"]} أداء:${q["أداء"]} تجويد:${q["تجويد"]}\n`);
                alert(s);
            } else {
                Logger.warn('No grades found for participant', { participantId: id });
                alert("لا توجد درجات.");
            }
        });
    });

    tbody.querySelectorAll('button.reset').forEach(b => {
        b.addEventListener('click', async () => {
            const id = b.dataset.id;
            Logger.info('Reset grades requested', { participantId: id });
            if (!confirm("هل تريد فعلاً إعادة تعيين درجات هذا المشارك؟")) {
                Logger.info('Grade reset cancelled', { participantId: id });
                return;
            }
            const res = await apiPost({ action: "reset_participant_grades", participant_id: id });
            if (res.ok) {
                Logger.info('Grades reset successfully', { participantId: id });
                alert("تمت إعادة التعيين. عدد الصفوف المحذوفة: " + (res.removed || 0));
                await refreshAll();
                renderAdminTable();
            } else {
                Logger.error('Grade reset failed', { participantId: id });
                alert("فشل إعادة التعيين.");
            }
        });
    });
}

async function addParticipant() {
    Logger.trace('addParticipant', 'Adding new participant');
    const name = $("#new_name").value.trim();
    if (!name) {
        Logger.warn('Add participant failed', { reason: 'No name provided' });
        return alert("أدخل اسم المشارك");
    }

    const payload = {
        action: "add_participant",
        "الاسم الثلاثي": name,
        "العمر": $("#new_age").value || "",
        "القسم التربوي": $("#new_dept").value || "",
        "عدد الأجزاء": $("#new_parts").value || "",
        "أرقام الأجزاء": $("#new_parts_idx").value || "",
        "اللجنة": $("#new_committee").value || ""
    };

    Logger.info('Adding participant');
    const res = await apiPost(payload);

    if (res.ok) {
        Logger.info('Participant added successfully', { id: res.id });
        alert("تمت الإضافة. المعرّف: " + res.id);
        await refreshAll();
        renderAdminTable();
    } else {
        Logger.error('Add participant failed');
        alert("فشل الإضافة: " + (res.error || ""));
    }
}

function setCommitteePassword() {
    Logger.info('Set committee password requested (manual process)');
    alert("لحفظ كلمة المرور: افتح صفحة Committees في Google Sheet وعدّل كلمة المرور مباشرة.");
}

async function resetParticipantGrades() {
    Logger.trace('resetParticipantGrades', 'Resetting participant grades');
    const pid = $("#reset_pid").value.trim();
    if (!pid) {
        Logger.warn('Reset grades failed', { reason: 'No participant ID provided' });
        return alert("أدخل معرّف المشارك لإعادة التعيين.");
    }

    if (!confirm("هل تريد إعادة تعيين الدرجات لهذا المشارك؟")) {
        Logger.info('Grade reset cancelled', { participantId: pid });
        return;
    }

    Logger.info('Resetting participant grades', { participantId: pid });
    const res = await apiPost({ action: "reset_participant_grades", participant_id: pid });

    if (res.ok) {
        Logger.info('Grades reset successfully', { participantId: pid });
        alert("تمت إعادة التعيين.");
        await refreshAll();
        renderAdminTable();
    } else {
        Logger.error('Grade reset failed', { participantId: pid });
        alert("فشل: " + (res.error || ""));
    }
}

function exportXlsx() {
    Logger.trace('exportXlsx', 'Starting XLSX export');
    const header = ["ID", "اللجنة", "الاسم الثلاثي", "العمر", "القسم التربوي", "عدد الأجزاء", 
                    "أرقام الأجزاء", "مجموع", "٪", "تقدير", "جائزة", "تم الإرسال", "timestamp"];
    const data = [header];

    state.participants.forEach(p => {
        const cfg = stageConfig(p["عدد الأجزاء"], p["العمر"]);
        const pct = cfg.stageTotal ? Math.round((p["المجموع"] || 0) / cfg.stageTotal * 10000) / 100 : 0;
        data.push([
            p.id,
            p["اللجنة"] || "",
            p["الاسم الثلاثي"] || "",
            p["العمر"] || "",
            p["القسم التربوي"] || "",
            p["عدد الأجزاء"] || "",
            p["أرقام الأجزاء"] || "",
            p["المجموع"] || 0,
            pct,
            p["تقدير"] || "",
            p["الجائزة المالية"] || 0,
            p.submitted ? "نعم" : "لا",
            p.timestamp || ""
        ]);
    });

    Logger.info('Exporting XLSX', { participantCount: state.participants.length });

    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Participants");
    XLSX.writeFile(wb, "quran_results.xlsx");

    Logger.info('XLSX export completed successfully');
}

function wireUI() {
    Logger.trace('wireUI', 'Wiring UI event handlers');

    $("#btnLogout")?.addEventListener('click', logout);

    $$(".tab").forEach(b => {
        b.addEventListener('click', () => {
            Logger.debug('Tab clicked', { tab: b.dataset.tab });
            $$(".tab").forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            const t = b.dataset.tab;
            $("#admin-scores").classList.toggle('hidden', t !== "scores");
            $("#admin-manage").classList.toggle('hidden', t !== "manage");
            $("#admin-export").classList.toggle('hidden', t !== "export");
        });
    });

    $("#admRefresh")?.addEventListener('click', async () => {
        Logger.info('Admin data refresh triggered');
        await refreshAll();
        renderAdminTable();
    });

    $("#admCommitteeFilter")?.addEventListener('change', renderAdminTable);
    $("#admSubmittedFilter")?.addEventListener('change', renderAdminTable);

    Logger.info('UI wiring completed');
}

window.addEventListener('error', (event) => {
    Logger.error('Uncaught error', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno
    });
});

window.addEventListener('unhandledrejection', (event) => {
    Logger.error('Unhandled promise rejection', {
        reason: event.reason
    });
});
