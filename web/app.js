import { calendarDate, localDateKey, monthCells } from "./dates.js";

const get = (id) => document.getElementById(id);
const dialog = get("role-dialog");
const form = get("role-form");
let roles = [];
let selectedId = null;
let month = new Date();
let submittingId = null;
const submitDialog = get("submit-dialog");
const dateInput = get("application-date");

for (const [modal, action] of [[dialog, "save-role"], [submitDialog, "confirm-submit"]]) {
  modal.addEventListener("cancel", (event) => {
    if (get(action).disabled) event.preventDefault();
  });
}

async function api(path, options) {
  const response = await fetch("/api" + path, options);
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error);
    error.status = response.status;
    throw error;
  }
  return data;
}

function showError(id, error) {
  const message = get(id);
  message.textContent = error?.message ?? "";
  message.hidden = !error;
}

function button(label, action) {
  const control = document.createElement("button");
  control.type = "button";
  control.textContent = label;
  control.addEventListener("click", action);
  return control;
}

function render() {
  get("draft-roles").replaceChildren();
  get("submitted-roles").replaceChildren();
  for (const role of roles) {
    const card = document.createElement("article");
    const title = document.createElement("strong");
    title.textContent = role.role_title;
    const company = document.createElement("p");
    company.textContent = role.company_name + " · " + role.company_type;
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(button("Open application", () => openRole(role.id)));
    if (role.submitted_on) {
      const date = document.createElement("p");
      date.textContent = "Applied " + role.submitted_on;
      card.append(title, company, date, actions);
    } else {
      actions.append(button("Mark submitted", () => openSubmission(role)));
      card.append(title, company, actions);
    }
    get(role.submitted_on ? "submitted-roles" : "draft-roles").append(card);
  }
  renderCalendar();
}

function renderCalendar() {
  get("month-name").textContent = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const grid = get("month-grid");
  grid.replaceChildren();
  for (const weekday of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
    const heading = document.createElement("div");
    heading.className = "weekday";
    heading.textContent = weekday;
    grid.append(heading);
  }
  const today = localDateKey(new Date());
  for (const date of monthCells(month)) {
    const cell = document.createElement("div");
    cell.className = "day";
    if (date) {
      const key = localDateKey(date);
      cell.classList.toggle("today", key === today);
      const label = document.createElement("time");
      label.dateTime = key;
      label.textContent = date.getDate();
      cell.append(label);
      for (const role of roles.filter((item) => item.submitted_on === key)) {
        cell.append(button(role.role_title + " · " + role.company_name, () => openRole(role.id)));
      }
    }
    grid.append(cell);
  }
}

function chooseToday() {
  dateInput.max = dateInput.value = localDateKey(new Date());
}

function openSubmission(role) {
  submittingId = role.id;
  get("submit-role-name").textContent = role.role_title + " · " + role.company_name;
  chooseToday();
  showError("submit-error");
  submitDialog.showModal();
}

get("submit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const confirm = get("confirm-submit");
  if (confirm.disabled) return;
  const cancel = get("cancel-submit");
  confirm.disabled = cancel.disabled = true;
  try {
    const role = await api("/roles/" + submittingId + "/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submitted_on: dateInput.value }),
    });
    const [year, monthNumber] = role.submitted_on.split("-").map(Number);
    month = calendarDate(year, monthNumber - 1);
    submitDialog.close();
    await refresh();
  } catch (error) {
    showError("submit-error", error);
    if (error.status === 409) await refresh();
  } finally {
    confirm.disabled = cancel.disabled = false;
  }
});

get("choose-today").addEventListener("click", chooseToday);
get("cancel-submit").addEventListener("click", () => submitDialog.close());
for (const [control, offset] of [["previous-month", -1], ["next-month", 1]]) {
  get(control).addEventListener("click", () => {
    month = calendarDate(month.getFullYear(), month.getMonth() + offset);
    renderCalendar();
  });
}

async function refresh() {
  try {
    roles = await api("/roles");
    render();
    showError("page-error");
  } catch (error) {
    showError("page-error", error);
  }
}

async function openRole(id) {
  try {
    const role = id === null ? null : await api("/roles/" + id);
    selectedId = id;
    form.reset();
    for (const field of ["company_name", "company_type", "role_title"]) {
      form.elements[field].value = role?.[field] ?? "";
    }
    get("role-heading").textContent = role?.role_title ?? "Add role";
    get("role-status").textContent = role?.submitted_on ? "Applied " + role.submitted_on : "Not submitted";
    renderAttachments(role);
    showError("role-error");
    showError("page-error");
    dialog.showModal();
  } catch (error) {
    showError("page-error", error);
  }
}

function renderAttachments(role) {
  get("attachments").hidden = !role;
  showError("attachment-error");
  const list = get("document-list");
  list.replaceChildren();
  if (!role) return;
  for (const [kind, title] of [["cv", "CV"], ["cover_letter", "Cover letter"]]) {
    const path = "/roles/" + role.id + "/attachments/" + kind;
    const label = document.createElement("label");
    label.append(title);
    const file = document.createElement("input");
    file.type = "file";
    const saved = document.createElement("a");
    saved.href = "/api" + path;
    let savedFilename;
    function update(filename) {
      savedFilename = filename;
      saved.hidden = !filename;
      saved.textContent = filename ? "Open saved " + title + " · " + filename : "";
    }
    update(role.attachments[kind]);
    file.addEventListener("change", async () => {
      const upload = file.files[0];
      if (!upload) return;
      if (savedFilename && !window.confirm("Replace the saved " + title + " (" + savedFilename + ")?")) {
        file.value = "";
        return;
      }
      file.disabled = true;
      showError("attachment-error");
      try {
        if (upload.size > 25 * 1024 ** 2) throw new Error("Choose a file no larger than 25 MiB.");
        const result = await api(path + "?filename=" + encodeURIComponent(upload.name), { method: "PUT", body: upload });
        update(result.attachments[kind]);
      } catch (error) {
        showError("attachment-error", error);
      } finally {
        file.value = "";
        file.disabled = false;
      }
    });
    label.append(file);
    list.append(label, saved);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const save = get("save-role");
  if (save.disabled) return;
  const close = get("close-role");
  save.disabled = close.disabled = true;
  try {
    await api(selectedId === null ? "/roles" : "/roles/" + selectedId, {
      method: selectedId === null ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    dialog.close();
    await refresh();
  } catch (error) {
    showError("role-error", error);
  } finally {
    save.disabled = close.disabled = false;
  }
});

get("close-role").addEventListener("click", () => dialog.close());
get("add-role").addEventListener("click", () => openRole(null));
for (const page of ["calendar", "board"]) {
  get("show-" + page).addEventListener("click", () => {
    for (const name of ["calendar", "board"]) {
      get(name + "-page").hidden = name !== page;
      get("show-" + name).setAttribute("aria-pressed", String(name === page));
    }
    refresh();
  });
}
refresh();
