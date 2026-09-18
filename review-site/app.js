/* Business-rules review capture.
 *
 * Reviewers have no login. The unguessable token in the link (?k=...) is the credential, and it
 * only ever reaches two SECURITY DEFINER functions -- the tables themselves are in a schema that
 * is not exposed to the API at all. A reviewer id minted in this browser separates people who
 * share one link; nobody can read anyone else's notes.
 *
 * Everything is written to localStorage first and to the database second, so a reviewer who loses
 * connectivity mid-sentence keeps their work and the page says so plainly.
 */
(function () {
  "use strict";

  var SUPABASE_URL = "https://nakvdkkezgdqxytygtqp.supabase.co";
  var SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ha3Zka2tlemdkcXh5dHlndHFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1OTc3NzksImV4cCI6MjA5NjE3Mzc3OX0.6V9sbDzz-GUN8DKljpiJ2v8MbjbbZRtTPRVQNGdSsCo";

  var MARKS = ["Confirm", "Change", "Question"];
  var LOCAL_KEY = "dogforce-rules-review-v3";
  var ID_KEY = "dogforce-rules-reviewer-id";

  var token = new URLSearchParams(window.location.search).get("k") || "";
  var online = false; // set true once the server has answered at least once

  /* ---------- local state ---------- */

  function readLocal() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function writeLocal(s) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(s)); return true; }
    catch (e) { return false; }
  }

  var state = readLocal();
  if (!state.sections) { state.sections = {}; }
  if (typeof state.reviewer !== "string") { state.reviewer = ""; }

  function entry(section) {
    if (!state.sections[section]) { state.sections[section] = { mark: null, note: "" }; }
    return state.sections[section];
  }

  var reviewerId = "";
  try {
    reviewerId = localStorage.getItem(ID_KEY) || "";
    if (!reviewerId || reviewerId.length < 8) {
      var bytes = new Uint8Array(12);
      (window.crypto || window.msCrypto).getRandomValues(bytes);
      reviewerId = Array.prototype.map
        .call(bytes, function (b) { return ("0" + b.toString(16)).slice(-2); })
        .join("");
      localStorage.setItem(ID_KEY, reviewerId);
    }
  } catch (e) {
    reviewerId = "anon" + String(Date.now());
  }

  /* ---------- server ---------- */

  function rpc(name, payload) {
    if (!token) { return Promise.reject(new Error("no-token")); }
    return fetch(SUPABASE_URL + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": "Bearer " + SUPABASE_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          var err = new Error(body.message || ("Request failed (" + res.status + ")"));
          err.status = res.status;
          throw err;
        });
      }
      return res.status === 204 ? null : res.json();
    });
  }

  function saveSection(section) {
    var e = entry(section);
    return rpc("rules_review_save", {
      p_token: token,
      p_reviewer: reviewerId,
      p_name: state.reviewer || null,
      p_section: section,
      p_mark: e.mark,
      p_note: e.note || null
    });
  }

  /* ---------- banner ---------- */

  var banner = document.createElement("div");
  banner.className = "conn";
  banner.setAttribute("role", "status");
  var standing = document.querySelector(".standing");
  if (standing && standing.parentNode) {
    standing.parentNode.insertBefore(banner, standing.nextSibling);
  }

  function setBanner(kind, text) {
    banner.className = "conn conn-" + kind;
    banner.textContent = text;
  }

  /* ---------- build the controls ---------- */

  var containers = Array.prototype.slice.call(document.querySelectorAll(".markup"));
  var fields = {}; // section -> {textarea, stateLine}

  var firstBody = document.querySelector("#s1 .body-col");
  var whoInput = null;
  if (firstBody) {
    var who = document.createElement("div");
    who.className = "who";
    var whoLabel = document.createElement("label");
    whoLabel.setAttribute("for", "reviewerName");
    whoLabel.textContent = "Your name";
    whoInput = document.createElement("input");
    whoInput.type = "text";
    whoInput.id = "reviewerName";
    whoInput.autocomplete = "name";
    whoInput.maxLength = 120;
    whoInput.placeholder = "So we know whose corrections these are";
    whoInput.value = state.reviewer;
    whoInput.addEventListener("input", function () {
      state.reviewer = whoInput.value;
      writeLocal(state);
      queueNameSync();
    });
    who.appendChild(whoLabel);
    who.appendChild(whoInput);
    firstBody.insertBefore(who, firstBody.querySelector(".markup"));
  }

  var nameTimer = null;
  function queueNameSync() {
    if (!token) { return; }
    if (nameTimer) { clearTimeout(nameTimer); }
    nameTimer = setTimeout(function () {
      // Re-stamp the name onto whatever this reviewer has already answered.
      Object.keys(state.sections).forEach(function (section) {
        var e = state.sections[section];
        if (e.mark || (e.note && e.note.trim())) { saveSection(section).catch(function () {}); }
      });
    }, 1200);
  }

  containers.forEach(function (box) {
    var section = box.getAttribute("data-section");
    var e = entry(section);

    var row = document.createElement("div");
    row.className = "markup-row";
    var label = document.createElement("span");
    label.className = "markup-label";
    label.textContent = "Your mark";
    row.appendChild(label);

    MARKS.forEach(function (mark) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mark-btn";
      btn.textContent = mark;
      btn.setAttribute("aria-pressed", e.mark === mark ? "true" : "false");
      btn.addEventListener("click", function () {
        var cur = entry(section);
        cur.mark = (cur.mark === mark) ? null : mark;
        writeLocal(state);
        render();
        push(section);
      });
      row.appendChild(btn);
    });
    box.appendChild(row);

    var ta = document.createElement("textarea");
    ta.className = "note-field";
    ta.rows = 2;
    ta.maxLength = 4000;
    ta.setAttribute("aria-label", "Your correction or question for " + section);
    ta.placeholder = "Type the correction, or the question you want to raise…";
    ta.value = e.note;

    var stateLine = document.createElement("span");
    stateLine.className = "note-state";
    stateLine.setAttribute("aria-live", "polite");

    var timer = null;
    ta.addEventListener("input", function () {
      entry(section).note = ta.value;
      writeLocal(state);
      stateLine.className = "note-state";
      stateLine.textContent = "Saving…";
      if (timer) { clearTimeout(timer); }
      timer = setTimeout(function () { push(section); render(); }, 700);
    });

    box.appendChild(ta);
    box.appendChild(stateLine);
    fields[section] = { textarea: ta, stateLine: stateLine };
  });

  function mark(section, cls, text) {
    var f = fields[section];
    if (!f) { return; }
    f.stateLine.className = "note-state " + cls;
    f.stateLine.textContent = text;
  }

  function push(section) {
    if (!token) {
      mark(section, "local", "Saved on this device");
      return;
    }
    mark(section, "", "Saving…");
    saveSection(section).then(function () {
      online = true;
      mark(section, "saved", "Saved");
      setBanner("ok", "Your answers are being saved as you type. You can close this page and come back to it.");
    }).catch(function (err) {
      mark(section, "local", "Saved on this device — not yet sent");
      setBanner("warn", "We cannot reach the server right now. Your answers are safe in this browser — keep going, and use “Copy my corrections” at the bottom if it does not recover.");
      if (err && err.status === 400) {
        setBanner("warn", err.message + " Your answers are still saved in this browser.");
      }
    });
  }

  /* ---------- tally ---------- */

  function render() {
    containers.forEach(function (box) {
      var section = box.getAttribute("data-section");
      var e = entry(section);
      Array.prototype.forEach.call(box.querySelectorAll(".mark-btn"), function (btn) {
        btn.setAttribute("aria-pressed", e.mark === btn.textContent ? "true" : "false");
      });
    });

    var counts = { Confirm: 0, Change: 0, Question: 0 };
    var touched = 0, notes = 0;
    containers.forEach(function (box) {
      var e = entry(box.getAttribute("data-section"));
      var hasNote = e.note && e.note.trim().length > 0;
      if (e.mark || hasNote) { touched++; }
      if (hasNote) { notes++; }
      if (e.mark && counts[e.mark] !== undefined) { counts[e.mark]++; }
    });

    var tally = document.getElementById("tally");
    if (!touched) {
      tally.textContent = "Nothing marked yet";
      return;
    }
    tally.textContent =
      touched + " of " + containers.length + " sections  ·  " +
      counts.Confirm + " confirm  ·  " +
      counts.Change + " change  ·  " +
      counts.Question + " question  ·  " +
      notes + " written " + (notes === 1 ? "note" : "notes");
  }

  /* ---------- export ---------- */

  function report() {
    var lines = ["DogForce business rules review — version 1.1"];
    if (state.reviewer && state.reviewer.trim()) {
      lines.push("Reviewed by: " + state.reviewer.trim());
    }
    lines.push("Sent: " + new Date().toLocaleString());
    lines.push("");

    var any = false;
    containers.forEach(function (box) {
      var section = box.getAttribute("data-section");
      var e = entry(section);
      var note = (e.note || "").trim();
      if (!e.mark && !note) { return; }
      any = true;
      lines.push((e.mark ? e.mark.toUpperCase() : "NOTE") + "  —  " + section);
      if (note) {
        note.split("\n").forEach(function (ln) { lines.push("    " + ln); });
      }
      lines.push("");
    });

    if (!any) { return "DogForce business rules review — nothing marked yet."; }
    return lines.join("\n");
  }

  document.getElementById("copyBtn").addEventListener("click", function () {
    var btn = this;
    var text = report();
    function done(msg) {
      btn.textContent = msg;
      setTimeout(function () { btn.textContent = "Copy my corrections"; }, 2200);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { done("Copied — paste it into your reply"); },
        function () { done("Copy failed"); }
      );
    } else {
      done("Copy unavailable");
    }
  });

  /* ---------- start ---------- */

  render();

  if (!token) {
    setBanner("local", "You are reading this without a review link, so your notes stay in this browser only. Use “Copy my corrections” at the bottom to send them to us — or ask us for your own link and they will save automatically.");
  } else {
    setBanner("", "Connecting…");
    rpc("rules_review_load", { p_token: token, p_reviewer: reviewerId })
      .then(function (rows) {
        online = true;
        (rows || []).forEach(function (r) {
          var e = entry(r.section_key);
          e.mark = r.mark;
          e.note = r.note || "";
          if (r.reviewer_name && !state.reviewer) { state.reviewer = r.reviewer_name; }
          var f = fields[r.section_key];
          if (f) { f.textarea.value = e.note; }
        });
        if (whoInput && state.reviewer) { whoInput.value = state.reviewer; }
        writeLocal(state);
        render();
        setBanner("ok", "Your answers are being saved as you type. You can close this page and come back to it.");
      })
      .catch(function (err) {
        setBanner("warn", (err && err.status === 400)
          ? err.message + " Your notes will stay in this browser."
          : "We cannot reach the server right now. Your notes are safe in this browser — keep going, and use “Copy my corrections” at the bottom if it does not recover.");
      });
  }
})();
