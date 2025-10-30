/** google-script.gs
 * Google Apps Script Web API for Qur'an Competition app
 * - endpoints via doGet / doPost with "action" param
 * - stores data in a Google Sheet (tabs: Participants, Committees)
 *
 * IMPORTANT:
 * - Deploy Web App (Execute as: Me, Who has access: Anyone)
 * - Note: this gives a public endpoint; use basic committee passwords stored in sheet for small events.
 */

/** UTILITIES **/
const SS_NAME = SpreadsheetApp.getActiveSpreadsheet().getName(); // for logs
function jsonResponse(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function corsHeaders(response){
  // Apps Script content service can't set headers freely, but this wrapper returns JSON that client can fetch.
  return response;
}

function rowToParticipant(rowObj){
  // ensure consistent fields
  return {
    id: rowObj.id || "",
    "الاسم الثلاثي": rowObj["الاسم الثلاثي"] || "",
    "العمر": Number(rowObj["العمر"]||"")||"",
    "القسم التربوي": rowObj["القسم التربوي"] || "",
    "عدد الأجزاء": rowObj["عدد الأجزاء"] || "",
    "أرقام الأجزاء": rowObj["أرقام الأجزاء"] || "",
    "اللجنة": rowObj["اللجنة"] || "",
    "حفظ": Number(rowObj["حفظ"]||0)||0,
    "أداء": Number(rowObj["أداء"]||0)||0,
    "تجويد": Number(rowObj["تجويد"]||0)||0,
    "المجموع": Number(rowObj["المجموع"]||0)||0,
    "المتوسط": Number(rowObj["المتوسط"]||0)||0,
    "تقدير": rowObj["تقدير"] || "",
    "الجائزة المالية": Number(rowObj["الجائزة المالية"]||0)||0,
    "submitted": !!rowObj["submitted"],
    "timestamp": rowObj["timestamp"] || ""
  };
}

/** Grading logic exactly as specified **/
function stageConfig(parts, age){
  const p = Number(parts) || 0;
  const tajOn = (Number(age)||0) > 12; // tajweed only if age > 12
  let N;
  if(p <= 1) N = 2;
  else if(p <= 10) N = Math.round(p * 2);
  else N = Math.round(p);
  const perH = 10, perA = 1, perT = tajOn ? 2 : 0;
  const perTotal = perH + perA + perT;
  const stageTotal = perTotal * N;
  return { N, perH, perA, perT, perTotal, stageTotal, tajOn };
}

const fullPrizeTable = {"0.5":10,"1":10,"2":15,"3":20,"4":25,"5":30,"6":35,"7":40,"8":45,"9":50,"10":55,"11":60,"12":65,"13":70,"14":75,"15":80,"16":85,"17":90,"18":95,"19":100,"20":105,"21":110,"22":115,"23":120,"24":125,"25":130,"26":135,"27":140,"28":145,"29":150,"30":155};
function prizeFromParts(p){ return fullPrizeTable[String(Number(p))] || 0; }

function paramsFromAge(a){
  const age = Number(a);
  if(!Number.isFinite(age)) return { minus:60, division:40 };
  if(age >= 9 && age <= 12) return { minus:50, division:50 };
  return { minus:60, division:40 };
}

function finalReward(avgPct, minus, division, prize){
  const A = Number(avgPct), L = Number(minus), M = Number(division)||1, P = Number(prize);
  if(!(A > 74)) return 0;
  const val = ((A - L) / M) * P;
  return val > 0 ? Math.ceil(val) : 0;
}

function gradeLabel(pct){
  pct = Number(pct)||0;
  if(pct < 50) return "راسب";
  if(pct < 70) return "مشاركة";
  if(pct >= 96) return "ممتاز";
  if(pct >= 86) return "جيد جداً";
  if(pct >= 75) return "جيد";
  return "مشاركة";
}

/** Spreadsheet helpers **/
// Participants sheet columns (order matters for reading/writing)
function participantsHeaders(){
  return ["id","الاسم الثلاثي","العمر","القسم التربوي","عدد الأجزاء","أرقام الأجزاء","اللجنة","حفظ","أداء","تجويد","المجموع","المتوسط","تقدير","الجائزة المالية","submitted","timestamp"];
}

function committeesHeaders(){
  return ["Committee","Password"];
}

function readParticipants(){
  const sheet = getSheetByName("Participants");
  if(!sheet) return [];
  const data = sheet.getDataRange().getValues();
  const headers = data.shift();
  // unify header names vs expected - we expect the sheet to have the exact headers above; if not, try mapping by position
  const rows = data.map(r => {
    const obj = {};
    for(let i=0;i<r.length;i++){ obj[ headers[i] || ("col"+i) ] = r[i]; }
    return obj;
  });
  // Ensure id exists (use row number as fallback)
  return rows.map((o, idx) => {
    if(!o.id) o.id = "row_" + (idx+2);
    return rowToParticipant(o);
  });
}

function writeParticipantsAll(participants){
  // overwrite Participants sheet with header + rows
  const sheet = getSheetByName("Participants");
  if(!sheet) throw new Error("Participants sheet missing.");
  sheet.clearContents();
  const headers = participantsHeaders();
  const rows = participants.map(p => headers.map(h => p[h] || ""));
  sheet.getRange(1,1,1,headers.length).setValues([headers]);
  if(rows.length) sheet.getRange(2,1,rows.length,rows[0].length).setValues(rows);
  return true;
}

function appendParticipant(p){
  const sheet = getSheetByName("Participants");
  if(!sheet) throw new Error("Participants sheet missing.");
  const headers = participantsHeaders();
  // create row array in same order
  const row = headers.map(h => p[h] || "");
  sheet.appendRow(row);
  // return id (we use row number id)
  const lastRow = sheet.getLastRow();
  return "row_" + lastRow;
}

function updateParticipantById(id, updates){
  const sheet = getSheetByName("Participants");
  if(!sheet) throw new Error("Participants sheet missing.");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  for(let r=1;r<data.length;r++){
    const rowId = data[r][0] || ("row_" + (r+1));
    if(String(rowId) === String(id)){
      // update fields in that row
      for(const k in updates){
        const colIndex = headers.indexOf(k);
        if(colIndex >= 0){
          sheet.getRange(r+1, colIndex+1).setValue(updates[k]);
        } else {
          // header not found -> skip
        }
      }
      // update timestamp
      const tsCol = headers.indexOf("timestamp");
      if(tsCol >= 0) sheet.getRange(r+1, tsCol+1).setValue(new Date().toISOString());
      return true;
    }
  }
  return false;
}

/** Committees sheet **/
function readCommittees(){
  const sheet = getSheetByName("Committees");
  if(!sheet) return [];
  const data = sheet.getDataRange().getValues();
  const headers = data.shift();
  return data.map(r => {
    const obj = {};
    for(let i=0;i<r.length;i++){ obj[ headers[i] || ("col"+i) ] = r[i]; }
    return obj;
  });
}

/** API: doGet/doPost routing **/
function doGet(e){
  const action = (e.parameter.action || "list").toLowerCase();
  try {
    if(action === "participants" || action === "list"){
      const parts = readParticipants();
      return jsonResponse({ ok:true, participants: parts });
    }
    if(action === "committees"){
      const comm = readCommittees();
      return jsonResponse({ ok:true, committees: comm });
    }
    return jsonResponse({ ok:false, error:"unknown action" });
  } catch(err){
    return jsonResponse({ ok:false, error: String(err) });
  }
}

function doPost(e){
  // Apps Script passes body parameters differently depending on contentType; support JSON body if provided
  let payload = {};
  try{
    if(e.postData && e.postData.type === "application/json"){
      payload = JSON.parse(e.postData.contents || "{}");
    } else {
      payload = e.parameter || {};
    }
  } catch(err){
    payload = e.parameter || {};
  }
  const action = (payload.action || payload.a || "").toLowerCase();
  try{
    if(action === "add_participant"){
      // expected fields: الاسم الثلاثي, العمر, القسم التربوي, عدد الأجزاء, أرقام الأجزاء, اللجنة
      const p = {
        id: "",
        "الاسم الثلاثي": payload["الالاسم"] || payload["الاسم الثلاثي"] || payload.name || payload["name"] || "",
        "العمر": payload["العمر"] || payload.age || "",
        "القسم التربوي": payload["القسم التربوي"] || payload.dept || "",
        "عدد الأجزاء": payload["عدد الأجزاء"] || payload.parts || "",
        "أرقام الأجزاء": payload["أرقام الأجزاء"] || payload.partsIdx || "",
        "اللجنة": payload["اللجنة"] || payload.committee || "",
        "حفظ": 0, "أداء": 0, "تجويد": 0, "المجموع": 0, "المتوسط": 0, "تقدير": "", "الجائزة المالية": 0, "submitted": false, "timestamp": ""
      };
      // compute derived fields
      const cfg = stageConfig(p["عدد الأجزاء"], p["العمر"]);
      p["عدد الأسئلة"] = cfg.N;
      // append
      const newId = appendParticipant(p);
      // write id back
      updateParticipantById(newId, { id: newId });
      return jsonResponse({ ok:true, id: newId });
    }

    if(action === "update_participant"){
      // require id
      const id = payload.id || payload.ID || payload.Id;
      if(!id) return jsonResponse({ ok:false, error:"missing id" });
      // only allow updates on specific fields
      const allowed = ["اللجنة","حفظ","أداء","تجويد","المجموع","المتوسط","تقدير","الجائزة المالية","submitted","العمر","عدد الأجزاء","الاسم الثلاثي","القسم التربوي","أرقام الأجزاء"];
      const updates = {};
      for(const k in payload){
        if(allowed.indexOf(k) >= 0) updates[k] = payload[k];
      }
      // recompute totals if h/a/t changed or age/parts changed
      // to recompute we need the full participant; read all and find by id:
      let parts = readParticipants();
      let p = parts.find(x => String(x.id) === String(id));
      if(!p) return jsonResponse({ ok:false, error:"participant not found" });
      // apply updates temporarily
      for(const k in updates) p[k] = updates[k];
      // recompute
      const cfg = stageConfig(p["عدد الأجزاء"], p["العمر"]);
      const H = Number(p["حفظ"]||0), A = Number(p["أداء"]||0), T = (cfg.tajOn ? Number(p["تجويد"]||0) : 0);
      const maxH = cfg.perH * cfg.N, maxA = cfg.perA * cfg.N, maxT = cfg.perT * cfg.N;
      p["حفظ"] = Math.min(Math.max(H,0), maxH);
      p["أداء"] = Math.min(Math.max(A,0), maxA);
      p["تجويد"] = cfg.tajOn ? Math.min(Math.max(T,0), maxT) : 0;
      p["المجموع"] = p["حفظ"] + p["أداء"] + p["تجويد"];
      p["المتوسط"] = cfg.stageTotal ? Math.round((p["المجموع"]/cfg.stageTotal*10000))/100 : 0;
      const pr = prizeFromParts(p["عدد الأجزاء"]);
      const { minus, division } = paramsFromAge(p["العمر"]);
      p["Minus"] = minus; p["Division"] = division; p["Full Prize"] = pr;
      p["الجائزة المالية"] = finalReward(p["المتوسط"], minus, division, pr);
      p["تقدير"] = gradeLabel(p["المتوسط"]);
      // now write back only the fields we care about
      const toWrite = {
        "حفظ": p["حفظ"],
        "أداء": p["أداء"],
        "تجويد": p["تجويد"],
        "المجموع": p["المجموع"],
        "المتوسط": p["المتوسط"],
        "تقدير": p["تقدير"],
        "الجائزة المالية": p["الجائزة المالية"],
        "اللجنة": p["اللجنة"]||p["اللجنة"],
        "العمر": p["العمر"],
        "عدد الأجزاء": p["عدد الأجزاء"],
        "الاسم الثلاثي": p["الاسم الثلاثي"],
        "القسم التربوي": p["القسم التربوي"],
        "أرقام الأجزاء": p["أرقام الأجزاء"],
        "submitted": !!payload.submitted
      };
      updateParticipantById(id, toWrite);
      return jsonResponse({ ok:true, id: id, result: p });
    }

    if(action === "get_participant"){
      const id = payload.id || payload.ID;
      if(!id) return jsonResponse({ ok:false, error:"missing id" });
      const parts = readParticipants();
      const p = parts.find(x=>String(x.id) === String(id));
      if(!p) return jsonResponse({ ok:false, error:"not found" });
      return jsonResponse({ ok:true, participant: p });
    }

    // simple: list participants (alias)
    if(action === "list" || action === "participants"){
      const parts = readParticipants();
      return jsonResponse({ ok:true, participants: parts });
    }

    // committees list
    if(action === "committees"){
      const comm = readCommittees();
      return jsonResponse({ ok:true, committees: comm });
    }

    return jsonResponse({ ok:false, error:"unknown action (post)" });
  } catch(err){
    return jsonResponse({ ok:false, error: String(err) });
  }
}
