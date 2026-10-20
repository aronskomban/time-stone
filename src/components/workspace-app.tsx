"use client";

import type { EmployeeRow, WorkspaceData } from "@/lib/workspace";
import type { WorkspaceRole } from "@/lib/auth";
import { downloadCsv, formatClock, hoursLabel, initials, prettyDate, timeLabel, timerElapsed, weekdayLabel as prettyWeekday } from "@/lib/format";
import {
  Bell, BriefcaseBusiness, CalendarClock, CalendarDays, Check, ChevronDown, ChevronRight, CircleDollarSign,
  ClipboardCheck, Clock3, Coffee, Download, FileBarChart, LayoutDashboard, ListChecks, LogOut, Menu, MoreHorizontal,
  Pause, Pencil, Play, Plus, Search, Settings, ShieldCheck, Square, Timer, UserRound, Users, X, Zap,
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import { appPost, sameAppPath } from "@/lib/client-fetch";

type View = "dashboard" | "employees" | "attendance" | "projects" | "tracker" | "leave" | "payroll" | "team" | "tasks" | "timesheets" | "approvals" | "reports" | "notifications" | "settings";

type ModalKind =
  | "team" | "employee" | "employeeEdit" | "project" | "member" | "task" | "taskEdit"
  | "entry" | "leave" | "leaveReview" | "review" | "org" | "profile";

type ModalContext = { taskId?: number; leaveId?: number; approvalId?: number; employeeId?: number; projectId?: number };

type Field = {
  name: string; label: string; type?: "text" | "email" | "date" | "number" | "select";
  options?: Array<[string | number, string]>; required?: boolean; step?: string;
  placeholder?: string; full?: boolean; defaultValue?: string | number;
};

type FormSpec = { title: string; eyebrow: string; action: string; fields: Field[]; extra: Record<string, unknown>; success: string };

const NAV: Array<{ id: View; label: string; icon: typeof LayoutDashboard; soon?: boolean }> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "employees", label: "Employees", icon: UserRound },
  { id: "attendance", label: "Attendance", icon: CalendarDays },
  { id: "projects", label: "Projects", icon: BriefcaseBusiness },
  { id: "tracker", label: "Time Tracker", icon: Timer },
  { id: "leave", label: "Leave Management", icon: CalendarClock },
  { id: "payroll", label: "Payroll", icon: CircleDollarSign, soon: true },
  { id: "team", label: "Team", icon: Users },
  { id: "tasks", label: "My Tasks", icon: ListChecks },
  { id: "timesheets", label: "Timesheets", icon: Clock3 },
  { id: "approvals", label: "Approvals", icon: ClipboardCheck },
  { id: "reports", label: "Reports", icon: FileBarChart },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "settings", label: "Settings", icon: Settings },
];

const NAV_GROUPS: Array<{ label: string; items: View[] }> = [
  { label: "OVERVIEW", items: ["dashboard"] },
  { label: "WORKSPACE", items: ["employees", "attendance", "projects", "tracker", "leave"] },
  { label: "YOUR WORK", items: ["team", "tasks", "timesheets", "approvals"] },
  { label: "INSIGHTS & CONTROL", items: ["reports", "notifications", "settings"] },
];

function navigationForRole(role: WorkspaceRole) {
  const allowed: Record<WorkspaceRole, View[]> = {
    employee: ["dashboard", "attendance", "tracker", "leave", "tasks", "timesheets", "notifications", "settings"],
    manager: ["dashboard", "employees", "attendance", "projects", "tracker", "leave", "team", "tasks", "timesheets", "approvals", "reports", "notifications", "settings"],
    owner: ["dashboard", "employees", "attendance", "projects", "tracker", "leave", "team", "tasks", "timesheets", "approvals", "reports", "notifications", "settings"],
  };
  const available = new Set(allowed[role]);
  return NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter((id) => available.has(id) && !NAV.find((item) => item.id === id)?.soon) })).filter((group) => group.items.length > 0);
}

const TITLES: Record<View, [string, string]> = {
  dashboard: ["Workforce overview", "Live people, capacity, and delivery signals."],
  employees: ["Employees", "Directory, assignments, and employment state."],
  attendance: ["Attendance", "Presence, clock events, and breaks are tracked separately from billable time."],
  projects: ["Projects", "Delivery health, staffing, and budget utilization."],
  tracker: ["Time tracker", "Capture focused work against projects and tasks."],
  leave: ["Leave management", "Requests and manager decisions, without assumed entitlements."],
  payroll: ["Payroll", "This module is not enabled in the current milestone."],
  team: ["Teams", "Department structure, membership, and capacity."],
  tasks: ["My tasks", "Assigned work, priority, and progress."],
  timesheets: ["Timesheets", "Daily work logs and weekly submission state."],
  approvals: ["Approvals", "Manager review queue with an audit trail."],
  reports: ["Reports", "Utilization and delivery analytics from live records."],
  notifications: ["Notifications", "Updates that need your attention."],
  settings: ["Settings", "Organization and profile preferences."],
};

const TIMEZONES = ["UTC", "America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Australia/Sydney"];
const WEEK_STARTS: Array<[number, string]> = [[0, "Sunday"], [1, "Monday"], [2, "Tuesday"], [3, "Wednesday"], [4, "Thursday"], [5, "Friday"], [6, "Saturday"]];

type ClientSession = { employeeId: number; name: string; title: string; email: string; role: WorkspaceRole; organizationName: string };

export default function WorkspaceApp({ initialData, session }: { initialData: WorkspaceData; session: ClientSession }) {
  const [data, setData] = useState(initialData);
  const [view, setView] = useState<View>("dashboard");
  const [navOpen, setNavOpen] = useState(false);
  const [modal, setModal] = useState<{ kind: ModalKind; ctx: ModalContext } | null>(null);
  const [search, setSearch] = useState("");
  const actorId = session.employeeId;
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState<number | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [filters, setFilters] = useState<StateFilters>({ employee: 0, team: 0, project: 0, status: "all", range: 30 });

  function updateFilters(next: Partial<StateFilters>) {
    setFilters((previous) => ({ ...previous, ...next }));
  }

  const actor = data.employees.find((row) => row.id === actorId) ?? data.employees[0];
  const navGroups = navigationForRole(session.role);
  const timer = data.activeTimer;
  const timerRunning = timer?.state === "running";

  useEffect(() => {
    if (!timer || !timerRunning) return;
    const interval = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [timer, timerRunning]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const elapsed = timer ? timerElapsed({ ...timer, pausedAt: timer.pausedAt }, tick ?? Date.parse(data.now)) : 0;

  const modalSpec = modal ? formSpec(modal.kind, data, modal.ctx, actorId) : null;
  const directory = useMemo(() => filterEmployees(data.employees, search, filters), [data.employees, search, filters]);
  const attendanceRows = useMemo(() => filterAttendance(data.attendance, search, filters, data.today), [data.attendance, search, filters, data.today]);

  async function mutate(payload: Record<string, unknown>, success: string) {
    setBusy(true);
    try {
      const response = await appPost("/api/v1/workspace", payload);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Request failed");
      if (result.data) setData(result.data as WorkspaceData);
      setModal(null);
      toast.success(success, result.invitationUrl ? { description: <a href={sameAppPath(result.invitationUrl as string)} className="dev-invitation-link">Open development invitation</a>, duration: 12000 } : undefined);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function open(target: View) {
    if (!navGroups.some((group) => group.items.includes(target))) return;
    setView(target);
    setNavOpen(false);
  }

  function launch(kind: ModalKind, ctx: ModalContext = {}) {
    setModal({ kind, ctx });
  }

  function handleNotification(id: number, target: string | null) {
    void mutate({ action: "markRead", notificationId: id }, "Marked as read");
    if (target && navGroups.some((group) => group.items.includes(target as View))) open(target as View);
  }

  async function signOut() {
    try {
      const response = await appPost("/api/auth/sign-out", {});
      if (!response.ok) throw new Error("Could not sign out");
      window.location.assign("/signin");
    } catch {
      toast.error("Could not sign out. Please retry.");
    }
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar glass-thick ${navOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><Zap size={18} strokeWidth={2.5} /></div>
          <div><b>time stone<span className="brand-dot">.</span></b><span>By Datasphere Cloud</span></div>
          <button className="icon-btn close-nav" onClick={() => setNavOpen(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>
         <div className="workspace-switcher" aria-label="Current organization">
           <span className="workspace-monogram">{initials(data.organization.name).slice(0, 1)}</span>
           <span><small>YOUR WORKSPACE</small><b title={data.organization.name}>{data.organization.name}</b></span>
         </div>
         <nav aria-label="Primary navigation">
           {navGroups.map((group) => (
             <div className="nav-group" key={group.label}>
               <div className="nav-caption">{group.label}</div>
               {group.items.map((id) => {
                 const item = NAV.find((entry) => entry.id === id);
                 if (!item) return null;
                 return (
                   <button key={item.id} className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => open(item.id)} aria-current={view === item.id ? "page" : undefined}>
                     <item.icon size={18} strokeWidth={1.8} /><span>{item.label}</span>
                     {item.id === "approvals" && data.stats.pendingApprovals > 0 && <span className="nav-count">{data.stats.pendingApprovals}</span>}
                   </button>
                 );
               })}
             </div>
           ))}
         </nav>
         <div className="sidebar-foot">
           <div className="sidebar-foot-label">SIGNED IN · {session.role.toUpperCase()}</div>
           <div className="profile-chip">
             <Avatar name={session.name} color={actor?.avatarColor} />
             <span><b title={session.name}>{session.name}</b><small title={session.email}>{session.email}</small></span>
             <button className="icon-btn compact" onClick={signOut} aria-label="Sign out"><LogOut size={16} /></button>
           </div>
         </div>
      </aside>
      {navOpen && <button className="scrim" onClick={() => setNavOpen(false)} aria-label="Close navigation" />}

      <div className="main-frame">
        <header className={`topbar glass-regular ${scrolled ? "scrolled" : ""}`}>
          <button className="icon-btn menu-btn" onClick={() => setNavOpen(true)} aria-label="Open navigation"><Menu size={19} /></button>
           <div className="crumb"><span>Workspace</span><ChevronRight size={14} /><b>{TITLES[view][0]}</b></div>
           <label className="global-search">
             <Search size={17} />
             <input value={search} onChange={(event) => { setSearch(event.target.value); if (event.target.value) setView("employees"); }} placeholder="Search employees…" aria-label="Search employees" enterKeyHint="search" />
             {search && <button type="button" onClick={() => setSearch("")} aria-label="Clear search"><X size={14} /></button>}
           </label>
          <div className={`timer-pill ${timerRunning ? "running" : ""} ${timer ? "engaged" : ""}`}>
            <span className="pulse-dot" />
            <strong>{timer ? formatClock(elapsed) : "No timer"}</strong>
            {timer ? (
              <button
                onClick={() => mutate(timerRunning ? { action: "pauseTimer" } : { action: "resumeTimer" }, timerRunning ? "Timer paused" : "Timer resumed")}
                aria-label={timerRunning ? "Pause timer" : "Resume timer"}
              >
                {timerRunning ? <Pause size={11} /> : <Play size={11} />}
              </button>
            ) : null}
            {timer ? (
              <button onClick={() => mutate({ action: "stopTimer" }, "Timer stopped and entry saved")} aria-label="Stop timer">
                <Square size={10} fill="currentColor" />
              </button>
            ) : null}
          </div>
          <button className="icon-btn notification-btn" onClick={() => open("notifications")} aria-label={`Notifications, ${data.notifications.filter((n) => !n.read).length} unread`}>
            <Bell size={17} />{data.notifications.some((item) => !item.read) && <i />}
          </button>
            <div className="signed-in-account" aria-label={`Signed in as ${session.name}, ${session.role}`}>
              <Avatar name={session.name} color={actor?.avatarColor} />
              <span><b>{session.name}</b><small>{session.role}</small></span>
            </div>
        </header>

         <main className="workspace">
           <div className="page-head">
             <div className="page-heading">
               <span className="eyebrow"><span className="eyebrow-line" /> {view === "dashboard" ? "THE BIG PICTURE" : "TIME STONE / " + TITLES[view][0].toUpperCase()}</span>
               <h1>{TITLES[view][0]}</h1>
               <p>{TITLES[view][1]}</p>
             </div>
              <ContextActions view={view} launch={launch} data={data} role={session.role} mutate={mutate} busy={busy} />
           </div>

          {view === "dashboard" && <Dashboard data={data} open={open} launch={launch} />}
          {view === "employees" && <Employees data={data} rows={directory} filters={filters} setFilters={updateFilters} launch={launch} role={session.role} />}
          {view === "attendance" && <Attendance data={data} actorId={actorId} rows={attendanceRows} filters={filters} setFilters={updateFilters} mutate={mutate} busy={busy} />}
          {view === "projects" && <Projects data={data} launch={launch} mutate={mutate} busy={busy} role={session.role} />}
          {view === "tracker" && <Tracker data={data} actorId={actorId} elapsed={elapsed} mutate={mutate} launch={launch} />}
          {view === "leave" && <Leave data={data} launch={launch} />}
          {view === "team" && <Teams data={data} launch={launch} role={session.role} />}
          {view === "tasks" && <Tasks data={data} actorId={actorId} launch={launch} />}
          {view === "timesheets" && <Timesheets data={data} actorId={actorId} mutate={mutate} busy={busy} />}
          {view === "approvals" && <Approvals data={data} launch={launch} />}
           {view === "reports" && <Reports data={data} />}
          {view === "notifications" && <Notifications data={data} mutate={mutate} onOpen={handleNotification} busy={busy} />}
          {view === "settings" && <SettingsView data={data} actor={actor} launch={launch} role={session.role} />}
          {view === "payroll" && <Unavailable />}
        </main>
      </div>

      <Toaster position="bottom-right" theme="light" richColors closeButton duration={4000} toastOptions={{ className: "stone-toast" }} />
      {modal && modalSpec && (
        <FormModal
          spec={modalSpec}
          busy={busy}
          close={() => setModal(null)}
submit={(values) => mutate({ action: modalSpec.action, ...modalSpec.extra, ...values }, modalSpec.success)}        />
      )}
    </div>
  );
}

/* ---------------------------------- shell --------------------------------- */

function ContextActions({ view, launch, data, role, mutate, busy }: {
  view: View; launch: (kind: ModalKind, ctx?: ModalContext) => void; data: WorkspaceData; role: WorkspaceRole; mutate: (p: Record<string, unknown>, s: string) => void; busy: boolean;
}) {
  const map: Partial<Record<View, [string, ModalKind]>> = {
    ...(role === "owner" ? { employees: ["Invite employee", "employee"] as [string, ModalKind], team: ["Create team", "team"] as [string, ModalKind], projects: ["New project", "project"] as [string, ModalKind] } : {}),
    ...(role === "owner" || role === "manager" ? { tasks: ["Assign task", "task"] as [string, ModalKind] } : {}),
    tracker: ["Manual entry", "entry"], leave: ["Request leave", "leave"],
  };
  const action = map[view];
  if (action) return <button className="primary-btn" onClick={() => launch(action[1])}><Plus size={15} />{action[0]}</button>;
  if (view === "timesheets") {
    return <button className="primary-btn" disabled={busy} onClick={() => mutate({ action: "submitTimesheet" }, "Timesheet submitted for review")}><ClipboardCheck size={15} />Submit week</button>;
  }
  if (view === "notifications") {
    return <button className="secondary-btn" disabled={busy} onClick={() => mutate({ action: "markAllRead" }, "All notifications marked read")}><Check size={15} />Mark all read</button>;
  }
  return <div className="date-control"><CalendarDays size={14} /><span>{prettyDate(data.today)}</span></div>;
}

function Dashboard({ data, open, launch }: { data: WorkspaceData; open: (view: View) => void; launch: (kind: ModalKind, ctx?: ModalContext) => void }) {
  const rate = Math.round((data.heatmap.reduce((sum, day) => sum + day.present, 0) / Math.max(1, data.heatmap.reduce((sum, day) => sum + day.total, 0))) * 100);
  const cards: Array<[string, string, string, string, typeof UserRound]> = [
    ["Total employees", String(data.stats.employeeCount), "Active workforce", "neutral", UserRound],
    ["Hours this week", hoursLabel(data.stats.weekSeconds), "All projects", "positive", Clock3],
    ["Open tasks", String(data.stats.openTasks), `${data.tasks.filter((task) => task.priority === "high" && task.status !== "done").length} high priority`, "warn", ListChecks],
    ["Active projects", String(data.stats.activeProjects), `${data.projects.length} total`, "neutral", BriefcaseBusiness],
    ["Pending approvals", String(data.stats.pendingApprovals), "Timesheet reviews", data.stats.pendingApprovals ? "warn" : "positive", ClipboardCheck],
    ["Pending leave", String(data.stats.pendingLeave), "Awaiting decision", data.stats.pendingLeave ? "warn" : "positive", CalendarClock],
  ];
  const pending = data.timesheets.filter((row) => row.approvalStatus === "pending");

   return (
     <>
       <section className="overview-hero" aria-label="Workspace summary">
         <div className="overview-hero-copy">
           <span className="hero-kicker"><span className="live-indicator" /> LIVE WORKSPACE · {prettyWeekday(data.today).toUpperCase()}, {prettyDate(data.today).toUpperCase()}</span>
           <h2>Your people.<br /><em>All in perspective.</em></h2>
           <p>A clear view of the work moving forward at {data.organization.name}.</p>
           <div className="hero-actions">
             <button className="hero-primary" onClick={() => open("tracker")}><Play size={15} fill="currentColor" /> Track time <ChevronRight size={15} /></button>
             <button className="hero-secondary" onClick={() => open("reports")}>Explore reports <ChevronRight size={15} /></button>
           </div>
         </div>
         <div className="hero-aside" aria-label="This week at a glance">
           <span className="hero-aside-label">THIS WEEK</span>
           <strong>{hoursLabel(data.stats.weekSeconds)}</strong>
           <span>of focused work logged</span>
           <div className="hero-aside-rule" />
           <div><span>{data.stats.activeProjects} active projects</span><span>{data.stats.employeeCount} people</span></div>
         </div>
       </section>
       <div className="section-heading"><div><span className="section-index">01 / WORKFORCE</span><h2>At a glance</h2></div><span>Real-time overview</span></div>
       <section className="kpi-grid wide-six" aria-label="Workforce metrics">
         {cards.map(([label, value, note, tone, Icon]) => (
           <article className="kpi" key={label}>
             <span className="kpi-icon"><Icon size={19} strokeWidth={1.8} /></span>
             <div className="kpi-copy"><span>{label}</span><b>{value}</b><small className={tone === "warn" ? "warn" : tone === "positive" ? "positive" : ""}>{note}</small></div>
           </article>
         ))}
       </section>
       <div className="section-heading secondary-heading"><div><span className="section-index">02 / OPERATIONS</span><h2>What’s happening</h2></div><span>Updated from your records</span></div>
      <section className="dashboard-grid">
        <Panel title="Attendance pulse" meta="Last 7 days" className="attendance-panel">
          <div className="heatmap-labels"><span>Presence rate</span><b>{rate}%</b></div>
          <div className="heatmap">
            {data.heatmap.map((day) => (
              <div key={day.day}>
                <span>{prettyWeekday(day.day)}</span>
                <i style={{ "--level": Math.max(0.06, day.present / Math.max(1, day.total)) } as React.CSSProperties} title={`${day.present} of ${day.total} present`} />
                <small>{day.present}/{day.total}</small>
              </div>
            ))}
          </div>
          <div className="legend"><span>Lower</span>{[0.15, 0.35, 0.55, 0.75, 1].map((level) => <i key={level} style={{ opacity: level }} />)}<span>Higher</span></div>
        </Panel>
        <Panel title="Project workload" meta="Tracked vs budget">
          <div className="workload">
            {data.workload.map((project) => (
              <div key={project.name}>
                <div><b>{project.label}</b><span>{project.tracked} / {project.budget}h</span></div>
                <div className="bar"><i style={{ width: `${Math.min(100, (project.tracked / Math.max(1, project.budget)) * 100)}%` }} /></div>
              </div>
            ))}
          </div>
          <button className="text-btn" onClick={() => open("reports")}>Open workload report <ChevronRight size={13} /></button>
        </Panel>
        <Panel title="Recent attendance" meta="Clock events" className="wide">
          <AttendanceTable rows={data.attendance.slice(0, 6)} />
          <button className="text-btn" onClick={() => open("attendance")}>View all attendance <ChevronRight size={13} /></button>
        </Panel>
        <Panel title="Pending approvals" meta={`${pending.length} pending`}>
          <div className="approval-list">
            {pending.map((row) => (
              <div key={row.id}>
                <Avatar name={row.employee} />
                <span><b>{row.employee}</b><small>Week of {prettyDate(row.weekStart)}</small></span>
                <strong>{hoursLabel(row.totalSeconds)}</strong>
              </div>
            ))}
            {!pending.length && <Empty title="Nothing waiting" text="Submitted timesheets appear here for review." />}
          </div>
          <button className="text-btn" onClick={() => open("approvals")}>Open review queue <ChevronRight size={13} /></button>
        </Panel>
        <Panel title="Team activity" meta="Latest recorded work" className="wide">
          <div className="entry-list">
            {data.entries.slice(0, 6).map((entry) => (
              <div key={entry.id}>
                <span className="entry-icon"><Clock3 size={14} /></span>
                <span><b>{entry.task ?? entry.project}</b><small>{entry.employee} · {entry.project}</small></span>
                <time>{prettyDate(entry.startedAt)}</time>
                <strong>{hoursLabel(entry.durationSeconds)}</strong>
              </div>
            ))}
            {!data.entries.length && <Empty title="No time recorded" text="Start a timer or add a manual entry to see activity." />}
          </div>
          <button className="text-btn" onClick={() => launch("entry")}>Add manual entry <Plus size={13} /></button>
        </Panel>
      </section>
    </>
  );
}

function Employees({ data, rows, filters, setFilters, launch, role }: {
  data: WorkspaceData; rows: EmployeeRow[]; filters: StateFilters;
  setFilters: (next: Partial<StateFilters>) => void; launch: (kind: ModalKind, ctx?: ModalContext) => void; role: WorkspaceRole;
}) {
  return (
    <>
      <FilterBar>
        <FilterSelect label="Team" value={filters.team} onChange={(value) => setFilters({ team: value })} options={[[0, "All teams"], ...data.teams.map((team) => [team.id, team.name] as [number, string])]} />
        <FilterSelect label="Status" value={filters.status} onChange={(value) => setFilters({ status: value })} options={ [["all", "All statuses"], ["active", "Active"], ["on_leave", "On leave"], ["inactive", "Inactive"]] as Array<[string, string]> } />
      </FilterBar>
      <Panel title="Employee directory" meta={`${rows.length} of ${data.employees.length} people`}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Employee</th><th>Role</th><th>Team</th><th>Manager</th><th>Status</th><th>Contact</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><div className="person"><Avatar name={row.name} color={row.avatarColor} /><span><b>{row.name}</b><small>{row.title}</small></span></div></td>
                  <td className="capitalize">{row.role}</td>
                  <td>{row.team ?? "Unassigned"}</td>
                  <td>{row.manager ?? "—"}</td>
                  <td><Status value={row.status} /></td>
                  <td>{row.email}</td>
                  <td className="row-actions">{role === "owner" && <button className="icon-btn compact" onClick={() => launch("employeeEdit", { employeeId: row.id })} aria-label={`Edit ${row.name}`}><Pencil size={14} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <Empty title="No matching employees" text="Adjust the filters or search term." />}
      </Panel>
    </>
  );
}

function Attendance({ data, actorId, rows, filters, setFilters, mutate, busy }: {
  data: WorkspaceData; actorId: number; rows: WorkspaceData["attendance"]; filters: StateFilters;
  setFilters: (next: Partial<StateFilters>) => void; mutate: (p: Record<string, unknown>, s: string) => void; busy: boolean;
}) {
  const mine = data.attendance.find((row) => row.employeeId === actorId && row.workDate === data.today);
  const openBreak = data.breaks.find((row) => row.employeeId === actorId && !row.endedAt);
  const shiftClosed = Boolean(mine?.clockOut);
  return (
    <div className="stack">
      <div className="inline-summary">
        <div><span>Your day · {prettyDate(data.today)}</span><b>{mine ? (mine.clockOut ? `Shift complete · out ${timeLabel(mine.clockOut)}` : `Clocked in ${timeLabel(mine.clockIn)}`) : "Not clocked in"}</b></div>
        <div className="action-cluster">
          <button className="secondary-btn" disabled={busy || (shiftClosed && !openBreak)} onClick={() => mutate({ action: openBreak ? "endBreak" : "startBreak" }, openBreak ? "Break ended" : "Break started")}>
            <Coffee size={14} />{openBreak ? "End break" : "Start break"}
          </button>
          <button
            className="primary-btn"
            disabled={busy || shiftClosed}
            onClick={() => mutate({ action: "clockIn" }, "Attendance updated")}
            title={shiftClosed ? "Attendance is already complete for today" : undefined}
          >
            {mine && !shiftClosed ? <LogOut size={14} /> : <Play size={14} />}
            {shiftClosed ? "Day complete" : mine ? "Clock out" : "Clock in"}
          </button>
        </div>
      </div>
      <FilterBar>
        <FilterSelect label="Employee" value={filters.employee} onChange={(value) => setFilters({ employee: value })} options={[[0, "All employees"], ...data.employees.map((row) => [row.id, row.name] as [number, string])]} />
        <FilterSelect label="Range" value={filters.range} onChange={(value) => setFilters({ range: value })} options={[[1, "Today"], [7, "Last 7 days"], [30, "Last 30 days"], [0, "All records"]] as Array<[number, string]>} />
      </FilterBar>
      <Panel title="Attendance history" meta={`${rows.length} records`}>
        <AttendanceTable rows={rows} />
        {!rows.length && <Empty title="No attendance records" text="Clock in to create today's record." />}
      </Panel>
      <Panel title="Break log" meta={`${data.breaks.length} recent breaks`}>
        <div className="entry-list">
          {data.breaks.slice(0, 10).map((row) => (
            <div key={row.id}>
              <span className="entry-icon"><Coffee size={14} /></span>
              <span><b>{row.employee}</b><small>{prettyDate(row.workDate)} · {timeLabel(row.startedAt)} – {timeLabel(row.endedAt)}</small></span>
              <strong>{hoursLabel((new Date(row.endedAt ?? data.now).getTime() - new Date(row.startedAt).getTime()) / 1000)}</strong>
            </div>
          ))}
          {!data.breaks.length && <Empty title="No breaks recorded" text="Break records appear once an employee starts one." />}
        </div>
      </Panel>
    </div>
  );
}

function AttendanceTable({ rows }: { rows: WorkspaceData["attendance"] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Employee</th><th>Date</th><th>Clock in</th><th>Clock out</th><th>Break</th><th>Presence</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td><div className="person"><Avatar name={row.employee} /><b>{row.employee}</b></div></td>
              <td>{prettyDate(row.workDate)}</td>
              <td>{timeLabel(row.clockIn)}</td>
              <td>{timeLabel(row.clockOut)}</td>
              <td>{hoursLabel(row.breakSeconds)}</td>
              <td><Status value={row.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Projects({ data, launch, mutate, busy, role }: { data: WorkspaceData; launch: (kind: ModalKind, ctx?: ModalContext) => void; mutate: (p: Record<string, unknown>, s: string) => void; busy: boolean; role: WorkspaceRole }) {
  return (
    <div className="project-grid">
      {data.projects.map((project) => {
        const roster = data.projectMembers.filter((row) => row.projectId === project.id);
        const utilization = Math.min(100, Math.round((project.trackedSeconds / 3600 / Math.max(1, project.budgetHours)) * 100));
        return (
          <article className="project-card" key={project.id}>
            <div className="project-top"><span className="project-code">{project.code}</span><Status value={project.status} /></div>
            <h3>{project.name}</h3>
            <p>{project.taskCount} tasks · {project.members} staffed · due {prettyDate(project.deadline)}</p>
            <div className="project-metric"><span>Budget utilization</span><b>{utilization}%</b></div>
            <div className="bar"><i style={{ width: `${utilization}%` }} /></div>
            <div className="project-foot"><span>{hoursLabel(project.trackedSeconds)} tracked</span><span>{project.budgetHours}h budget</span></div>
            <div className="roster">
              {roster.map((member) => (
                <span className="roster-chip" key={member.id}>
                  {member.employee}
                  {(role === "owner" || role === "manager") && <button onClick={() => mutate({ action: "removeProjectMember", projectId: project.id, employeeId: member.employeeId }, "Member removed")} aria-label={`Remove ${member.employee}`} disabled={busy}><X size={11} /></button>}
                </span>
              ))}
              {(role === "owner" || role === "manager") && <button className="roster-add" onClick={() => launch("member", { projectId: project.id })} disabled={busy}><Plus size={11} /> Add member</button>}
            </div>
          </article>
        );
      })}
      {!data.projects.length && <Panel title="Projects" meta="No records"><Empty title="No projects yet" text="Create a project to begin tracking work." /></Panel>}
    </div>
  );
}

function Tracker({ data, actorId, elapsed, mutate, launch }: {
  data: WorkspaceData; actorId: number; elapsed: number; mutate: (p: Record<string, unknown>, s: string) => void; launch: (kind: ModalKind, ctx?: ModalContext) => void;
}) {
  const timer = data.activeTimer;
  const [projectId, setProjectId] = useState<number>(timer?.projectId ?? data.projects[0]?.id ?? 0);
  const projectTasks = data.tasks.filter((task) => task.projectId === projectId);
  const [taskId, setTaskId] = useState<number | undefined>(timer?.taskId ?? projectTasks[0]?.id);
  const running = timer?.state === "running";

  return (
    <div className="stack">
      <section className={`timer-console glass-regular ${timer ? "is-active" : ""}`}>
        <div className="timer-ring"><span>{running ? <Pause size={19} /> : <Play size={19} />}</span></div>
        <div className="timer-copy">
          <span>{timer ? (running ? "TRACKING NOW" : "TIMER PAUSED") : "READY TO FOCUS"}</span>
          <b>{timer ? formatClock(elapsed) : "00:00:00"}</b>
          <p>{timer ? data.tasks.find((task) => task.id === timer.taskId)?.title ?? data.projects.find((project) => project.id === timer.projectId)?.name : "Select a project and task, then start the timer."}</p>
        </div>
        <div className="timer-fields">
          <label>Project
            <select value={projectId} disabled={!!timer} onChange={(event) => { const id = Number(event.target.value); setProjectId(id); setTaskId(data.tasks.find((task) => task.projectId === id)?.id); }}>
              {data.projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label>Task
            <select value={taskId ?? ""} disabled={!!timer} onChange={(event) => setTaskId(event.target.value ? Number(event.target.value) : undefined)}>
              <option value="">General project work</option>
              {projectTasks.map((task) => <option value={task.id} key={task.id}>{task.title}</option>)}
            </select>
          </label>
        </div>
        <div className="action-cluster">
          {timer && (
            <button className="secondary-btn" onClick={() => mutate(running ? { action: "pauseTimer" } : { action: "resumeTimer" }, running ? "Timer paused" : "Timer resumed")}>
              {running ? <Pause size={14} /> : <Play size={14} />}{running ? "Pause" : "Resume"}
            </button>
          )}
          {timer ? (
            <button className="stop-btn" onClick={() => mutate({ action: "stopTimer" }, "Timer stopped and entry saved")}><Square size={13} />Stop</button>
          ) : (
            <button className="primary-btn" onClick={() => mutate({ action: "startTimer", projectId, taskId }, "Timer started")}><Play size={14} />Start timer</button>
          )}
        </div>
      </section>

      <Panel title="Recent time entries" meta={`${data.entries.length} recent`} action={<button className="text-btn tight" onClick={() => launch("entry")}><Plus size={13} />Manual entry</button>}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Task</th><th>Project</th><th>Employee</th><th>Date</th><th>Source</th><th>Duration</th></tr></thead>
            <tbody>
              {data.entries.map((entry) => (
                <tr key={entry.id}>
                  <td><b>{entry.task ?? "General work"}</b>{entry.note ? <small className="block-note">{entry.note}</small> : null}</td>
                  <td>{entry.project}</td>
                  <td>{entry.employee}</td>
                  <td>{prettyDate(entry.startedAt)}</td>
                  <td><span className="source-chip">{entry.source}</span></td>
                  <td><b>{hoursLabel(entry.durationSeconds)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.entries.length && <Empty title="No time recorded" text="Start the timer or add a manual entry." />}
      </Panel>
    </div>
  );
}

function Leave({ data, launch }: { data: WorkspaceData; launch: (kind: ModalKind, ctx?: ModalContext) => void }) {
  return (
    <Panel title="Leave requests" meta={`${data.stats.pendingLeave} awaiting decision`}>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Employee</th><th>Category</th><th>Dates</th><th>Reason</th><th>Status</th><th>Review</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {data.leaves.map((row) => (
              <tr key={row.id}>
                <td><div className="person"><Avatar name={row.employee} /><b>{row.employee}</b></div></td>
                <td>{row.category}</td>
                <td>{prettyDate(row.startDate)} – {prettyDate(row.endDate)}</td>
                <td>{row.reason}</td>
                <td><Status value={row.status} /></td>
                <td>{row.reviewNote ?? "—"}</td>
                <td className="row-actions">
                  {row.status === "pending" && <button className="secondary-btn compact-btn" onClick={() => launch("leaveReview", { leaveId: row.id })}>Review</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.leaves.length && <Empty title="No leave requests" text="Submitted requests appear here for review." />}
    </Panel>
  );
}

function Teams({ data, launch, role }: { data: WorkspaceData; launch: (kind: ModalKind, ctx?: ModalContext) => void; role: WorkspaceRole }) {
  return (
    <div className="team-grid">
      {data.teams.map((team) => {
        const members = data.employees.filter((row) => row.teamId === team.id);
        const load = data.timeByEmployee.filter((row) => members.some((member) => member.id === row.employeeId)).reduce((sum, row) => sum + row.seconds, 0);
        return (
          <article className="team-card" key={team.id}>
            <div className="team-icon"><Users size={17} /></div>
            <div><span>{team.department ?? "Organization"}</span><h3>{team.name}</h3><p>{team.description}</p></div>
            <footer>
              <div className="avatar-stack">{members.slice(0, 4).map((member) => <Avatar key={member.id} name={member.name} color={member.avatarColor} />)}</div>
              <b>{members.length} members · {hoursLabel(load)}</b>
            </footer>
          </article>
        );
      })}
      {!data.teams.length && <Panel title="Teams" meta="No records"><Empty title="No teams yet" text="Create a team to group employees." /></Panel>}
      {role === "owner" && <button className="ghost-create" onClick={() => launch("team")}><Plus size={16} />Create team</button>}
    </div>
  );
}

function Tasks({ data, actorId, launch }: { data: WorkspaceData; actorId: number; launch: (kind: ModalKind, ctx?: ModalContext) => void }) {
  const mine = data.tasks.filter((task) => task.assigneeId === actorId);
  const rows = mine.length ? mine : data.tasks;
  return (
    <Panel title={mine.length ? "Assigned to you" : "All active tasks"} meta={`${rows.length} tasks`}>
      <div className="task-list">
        {rows.map((task) => (
          <div key={task.id}>
            <span className={`priority ${task.priority}`} />
            <span><b>{task.title}</b><small>{task.project} · {task.assignee ?? "Unassigned"} · due {prettyDate(task.dueDate)}</small></span>
            <div className="mini-progress"><i style={{ width: `${task.progress}%` }} /></div>
            <em>{task.progress}%</em>
            <Status value={task.status} />
            <button className="icon-btn compact" onClick={() => launch("taskEdit", { taskId: task.id })} aria-label={`Update ${task.title}`}><Pencil size={14} /></button>
          </div>
        ))}
      </div>
      {!rows.length && <Empty title="No tasks assigned" text="Assign a task from the projects workspace." />}
    </Panel>
  );
}

function Timesheets({ data, actorId, mutate, busy }: { data: WorkspaceData; actorId: number; mutate: (p: Record<string, unknown>, s: string) => void; busy: boolean }) {
  return (
    <div className="stack">
      <Panel title="Daily work logs" meta={`Week of ${prettyDate(data.weekStart)}`}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Employee</th>{data.weekDays.map((day) => <th key={day} className="num">{prettyWeekday(day)}</th>)}<th className="num">Total</th><th>State</th></tr>
            </thead>
            <tbody>
              {data.weekGrid.map((row) => (
                <tr key={row.employeeId}>
                  <td><b>{row.employee}</b></td>
                  {row.days.map((seconds, index) => <td key={index} className={`num ${seconds ? "" : "muted"}`}>{seconds ? hoursLabel(seconds) : "—"}</td>)}
                  <td className="num"><b>{hoursLabel(row.total)}</b></td>
                  <td>{row.status ? <Status value={row.status} /> : <span className="status">draft</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.weekGrid.length && <Empty title="No time this week" text="Recorded time populates the daily log." />}
      </Panel>
      <Panel title="Weekly timesheets" meta="Submission locks the weekly total for review">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Employee</th><th>Week</th><th>Total</th><th>Status</th><th>Reviewer comment</th></tr></thead>
            <tbody>
              {data.timesheets.map((row) => (
                <tr key={row.id}>
                  <td><b>{row.employee}</b></td>
                  <td>Week of {prettyDate(row.weekStart)}</td>
                  <td><b>{hoursLabel(row.totalSeconds)}</b></td>
                  <td><Status value={row.status} /></td>
                  <td>{row.comment ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.timesheets.length && <Empty title="No timesheets yet" text="Submit the current week to start a review." />}
        <button className="primary-btn table-action" disabled={busy} onClick={() => mutate({ action: "submitTimesheet" }, "Timesheet submitted for review")}><ClipboardCheck size={14} />Submit current week</button>
      </Panel>
    </div>
  );
}

function Approvals({ data, launch }: { data: WorkspaceData; launch: (kind: ModalKind, ctx?: ModalContext) => void }) {
  const pending = data.timesheets.filter((row) => row.approvalStatus === "pending");
  const decided = data.timesheets.filter((row) => row.approvalStatus && row.approvalStatus !== "pending");
  return (
    <div className="stack">
      <Panel title="Review queue" meta={`${pending.length} pending`}>
        <div className="review-list">
          {pending.map((row) => (
            <div key={row.id}>
              <Avatar name={row.employee} />
              <span><b>{row.employee}</b><small>Week of {prettyDate(row.weekStart)} · {hoursLabel(row.totalSeconds)}</small></span>
              <button className="secondary-btn" onClick={() => launch("review", { approvalId: row.approvalId ?? undefined })}>Review</button>
            </div>
          ))}
          {!pending.length && <Empty title="Queue is clear" text="New submissions appear here automatically." />}
        </div>
      </Panel>
      <Panel title="Review history" meta={`${decided.length} decided`}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Employee</th><th>Week</th><th>Total</th><th>Decision</th><th>Comment</th></tr></thead>
            <tbody>
              {decided.map((row) => (
                <tr key={row.id}>
                  <td><b>{row.employee}</b></td><td>{prettyDate(row.weekStart)}</td><td>{hoursLabel(row.totalSeconds)}</td>
                  <td><Status value={row.approvalStatus ?? ""} /></td><td>{row.comment ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!decided.length && <Empty title="No decisions yet" text="Approved and rejected timesheets are listed here." />}
      </Panel>
    </div>
  );
}

function Reports({ data }: { data: WorkspaceData }) {
  const [focus, setFocus] = useState("all");
  const maxEmployee = Math.max(...data.timeByEmployee.map((row) => row.seconds), 1);
  const maxProject = Math.max(...data.projects.map((row) => row.trackedSeconds), 1);
  const statusCounts = ["present", "late"].map((status) => [status, data.attendance.filter((row) => row.status === status).length] as const);

  return (
    <div className="stack">
      <FilterBar>
         <FilterSelect label="Focus" value={focus} onChange={setFocus} options={[["all", "All reports"], ["people", "People"], ["projects", "Projects"]] as Array<[string, string]>} />
        <div className="export-cluster">
          <button className="secondary-btn" onClick={() => downloadCsv("time-by-employee.csv", [["Employee", "Entries", "Hours"], ...data.timeByEmployee.map((row) => [row.employee, row.entries, (row.seconds / 3600).toFixed(2)])])}><Download size={14} />People CSV</button>
          <button className="secondary-btn" onClick={() => downloadCsv("time-by-project.csv", [["Project", "Code", "Tracked hours", "Budget hours"], ...data.projects.map((row) => [row.name, row.code, (row.trackedSeconds / 3600).toFixed(2), row.budgetHours])])}><Download size={14} />Project CSV</button>
          <button className="secondary-btn" onClick={() => downloadCsv("attendance.csv", [["Employee", "Date", "Clock in", "Clock out", "Break minutes", "Status"], ...data.attendance.map((row) => [row.employee, row.workDate, timeLabel(row.clockIn), timeLabel(row.clockOut), Math.round(row.breakSeconds / 60), row.status])])}><Download size={14} />Attendance CSV</button>
        </div>
      </FilterBar>
      <section className="dashboard-grid">
         {(focus === "all" || focus === "people") && <Panel title="Time by employee" meta="All recorded work" className="wide">
          <div className="rank-list">
            {data.timeByEmployee.map((row) => (
              <div key={row.employeeId}>
                <span><b>{row.employee}</b><small>{row.entries} entries</small></span>
                <div className="bar"><i style={{ width: `${(row.seconds / maxEmployee) * 100}%` }} /></div>
                <b>{hoursLabel(row.seconds)}</b>
              </div>
            ))}
          </div>
           {!data.timeByEmployee.length && <Empty title="No time recorded" text="Totals appear once time is tracked." />}
         </Panel>}
         {(focus === "all" || focus === "projects") && <Panel title="Time by project" meta="Tracked vs budget">
          <div className="chart-bars">
            {data.projects.map((project) => (
              <div key={project.id}>
                <b>{hoursLabel(project.trackedSeconds)}</b>
                <i style={{ height: `${Math.max(8, (project.trackedSeconds / maxProject) * 150)}px` }} />
                <span>{project.code}</span>
              </div>
            ))}
           </div>
         </Panel>}
         {(focus === "all" || focus === "people") && <Panel title="Attendance mix" meta="Recent records">
          <div className="report-facts">
            {statusCounts.map(([status, count]) => <span key={status}><i />{status} <b>{count}</b></span>)}
           <span><i className="dim" />break time <b>{hoursLabel(data.attendance.reduce((sum, row) => sum + row.breakSeconds, 0))}</b></span>
           </div>
         </Panel>}
         {(focus === "all" || focus === "projects") && <Panel title="Task completion" meta="Portfolio average">
          <div className="donut-wrap">
            <div className="donut" style={{ "--pct": `${averageProgress(data.tasks)}%` } as React.CSSProperties}><b>{averageProgress(data.tasks)}%</b><span>average</span></div>
            <div className="report-facts">
              {["in_progress", "review", "todo", "done"].map((status) => (
                <span key={status}><i className="dim" />{status.replace("_", " ")} <b>{data.tasks.filter((task) => task.status === status).length}</b></span>
              ))}
            </div>
           </div>
         </Panel>}
       </section>
    </div>
  );
}

function Notifications({ data, mutate, onOpen, busy }: { data: WorkspaceData; mutate: (p: Record<string, unknown>, s: string) => void; onOpen: (id: number, view: string | null) => void; busy: boolean }) {
  return (
    <Panel title="Notification center" meta={`${data.notifications.filter((row) => !row.read).length} unread`}>
      <div className="notification-list">
        {data.notifications.map((row) => (
          <button key={row.id} className={row.read ? "read" : ""} disabled={busy} onClick={() => onOpen(row.id, row.view)}>
            <span className="entry-icon"><Bell size={14} /></span>
            <span><b>{row.title}</b><small>{row.body}</small></span>
            <time>{prettyDate(row.createdAt)}</time>
            {!row.read && <i />}
          </button>
        ))}
      </div>
      {!data.notifications.length && <Empty title="No notifications" text="Workflow events create notifications here." />}
      <p className="hint">Selecting a notification marks it read and opens the related workspace.</p>
    </Panel>
  );
}

function SettingsView({ data, actor, launch, role }: { data: WorkspaceData; actor?: EmployeeRow; launch: (kind: ModalKind, ctx?: ModalContext) => void; role: WorkspaceRole }) {
  return (
    <div className="stack">
      <Panel title="Organization preferences" meta={`${data.organization.timezone} · week starts ${WEEK_STARTS.find(([value]) => value === data.organization.weekStartsOn)?.[1] ?? "Monday"}`}
        action={role === "owner" ? <button className="secondary-btn" onClick={() => launch("org")}><Pencil size={14} />Edit</button> : undefined}>
        <div className="settings-grid">
          <div><span>Organization name</span><b>{data.organization.name}</b></div>
          <div><span>Timezone</span><b>{data.organization.timezone}</b></div>
          <div><span>Week starts on</span><b>{WEEK_STARTS.find(([value]) => value === data.organization.weekStartsOn)?.[1] ?? "Monday"}</b></div>
          <div><span>Employees</span><b>{data.employees.length}</b></div>
        </div>
      </Panel>
      <Panel title="Profile preferences" meta="Your signed-in account"
        action={<button className="secondary-btn" onClick={() => launch("profile", { employeeId: actor?.id })}><Pencil size={14} />Edit</button>}>
        <div className="settings-grid">
          <div><span>Name</span><b>{actor?.name}</b></div>
          <div><span>Title</span><b>{actor?.title}</b></div>
          <div><span>Team</span><b>{actor?.team ?? "Unassigned"}</b></div>
          <div><span>Workspace role</span><b className="capitalize">{actor?.role}</b></div>
        </div>
      </Panel>
      <Panel title="Application configuration" meta="Read-only in this milestone">
        <div className="settings-grid">
          <div><span>Authentication</span><b>Session cookie · verified email</b></div>
          <div><span>Payroll module</span><b>Not enabled</b></div>
          <div><span>Audit events</span><b>Recording</b></div>
          <div><span>Data store</span><b>PostgreSQL · Drizzle</b></div>
        </div>
      </Panel>
    </div>
  );
}

function Unavailable() {
  return (
    <div className="unavailable">
      <span><Settings size={22} /></span>
      <h2>Module not enabled</h2>
      <p>This area is intentionally marked unavailable rather than presented as a non-functional feature.</p>
    </div>
  );
}

/* ---------------------------------- forms --------------------------------- */

function formSpec(kind: ModalKind, data: WorkspaceData, ctx: ModalContext, actorId: number): FormSpec {
  const task = data.tasks.find((row) => row.id === ctx.taskId);
  const employee = data.employees.find((row) => row.id === ctx.employeeId);
  const leave = data.leaves.find((row) => row.id === ctx.leaveId);
  const approval = data.timesheets.find((row) => row.approvalId === ctx.approvalId);

  switch (kind) {
    case "team":
      return { title: "Create team", eyebrow: "ORGANIZATION", action: "createTeam", success: "Team created", extra: {},
        fields: [{ name: "name", label: "Team name", required: true, full: true }, { name: "description", label: "Description", full: true }] };
    case "employee":
    case "employeeEdit":
      return {
        title: kind === "employee" ? "Invite employee" : "Edit employee", eyebrow: "PEOPLE", success: kind === "employee" ? "Invitation sent" : "Employee updated",
        action: kind === "employee" ? "createEmployee" : "updateEmployee",
        extra: kind === "employeeEdit" ? { employeeId: employee?.id } : {},
        fields: [
          { name: "name", label: "Full name", required: true, full: true, defaultValue: employee?.name },
          ...(kind === "employee" ? [{ name: "email", label: "Work email", type: "email" as const, required: true, full: true, placeholder: "name@yourcompany.com" }] : []),
          { name: "title", label: "Job title", required: true, full: true, defaultValue: employee?.title },
          { name: "teamId", label: "Team", type: "select", required: true, options: data.teams.map((team) => [team.id, team.name]), defaultValue: employee?.teamId ?? data.teams[0]?.id },
          ...(kind === "employee" ? [
            { name: "role", label: "Workspace role", type: "select" as const, required: true, options: [["employee", "Employee"], ["manager", "Manager"]] as Array<[string, string]>, defaultValue: "employee" },
          ] : []),
          ...(kind === "employeeEdit" ? [
            { name: "role", label: "Workspace role", type: "select" as const, required: true, options: [["employee", "Employee"], ["manager", "Manager"], ["owner", "Owner"]] as Array<[string, string]>, defaultValue: employee?.role },
            { name: "status", label: "Employment status", type: "select" as const, required: true, options: [["active", "Active"], ["on_leave", "On leave"], ["inactive", "Inactive"]] as Array<[string, string]>, defaultValue: employee?.status },
          ] : []),
        ],
      };
    case "project":
      return { title: "Create project", eyebrow: "DELIVERY", action: "createProject", success: "Project created", extra: {},
        fields: [
          { name: "name", label: "Project name", required: true, full: true },
          { name: "code", label: "Short code", required: true, placeholder: "ORB" },
          { name: "deadline", label: "Deadline", type: "date", required: true },
          { name: "budgetHours", label: "Budget hours", type: "number", required: true, placeholder: "240" },
        ] };
    case "member":
      return { title: "Add project member", eyebrow: "STAFFING", action: "addProjectMember", success: "Member added", extra: { projectId: ctx.projectId },
        fields: [{ name: "employeeId", label: "Employee", type: "select", required: true, options: data.employees.map((row) => [row.id, row.name]) }] };
    case "task":
      return { title: "Assign task", eyebrow: "WORK", action: "createTask", success: "Task assigned", extra: {},
        fields: [
          { name: "title", label: "Task title", required: true, full: true },
          { name: "projectId", label: "Project", type: "select", required: true, options: data.projects.map((row) => [row.id, row.name]), defaultValue: ctx.projectId ?? data.projects[0]?.id },
          { name: "assigneeId", label: "Assignee", type: "select", required: true, options: data.employees.map((row) => [row.id, row.name]) },
          { name: "priority", label: "Priority", type: "select", required: true, options: [["low", "Low"], ["medium", "Medium"], ["high", "High"]], defaultValue: "medium" },
          { name: "dueDate", label: "Due date", type: "date", required: true },
        ] };
    case "taskEdit":
      return { title: "Update task", eyebrow: task?.project ?? "WORK", action: "updateTask", success: "Task updated", extra: { taskId: ctx.taskId },
        fields: [
          { name: "status", label: "Status", type: "select", required: true, options: [["todo", "To do"], ["in_progress", "In progress"], ["review", "In review"], ["done", "Done"]], defaultValue: task?.status },
          { name: "progress", label: "Progress percent", type: "number", defaultValue: task?.progress },
        ] };
    case "entry":
      return { title: "Add manual time", eyebrow: "TIME", action: "manualEntry", success: "Time entry saved", extra: {},
        fields: [
          { name: "projectId", label: "Project", type: "select", required: true, options: data.projects.map((row) => [row.id, row.name]) },
          { name: "taskId", label: "Task (optional)", type: "select", options: [["", "General project work"], ...data.tasks.map((row) => [row.id, row.title] as [number, string])] },
          { name: "workDate", label: "Work date", type: "date", required: true, defaultValue: data.today },
          { name: "hours", label: "Hours", type: "number", required: true, step: "0.25", placeholder: "2.5" },
          { name: "note", label: "Note", full: true },
        ] };
    case "leave":
      return { title: "Request leave", eyebrow: "ABSENCE", action: "requestLeave", success: "Leave request submitted", extra: {},
        fields: [
          { name: "category", label: "Category", type: "select", required: true, options: [["Personal", "Personal"], ["Vacation", "Vacation"], ["Medical", "Medical"], ["Other", "Other"]] },
          { name: "startDate", label: "Start date", type: "date", required: true, defaultValue: data.today },
          { name: "endDate", label: "End date", type: "date", required: true, defaultValue: data.today },
          { name: "reason", label: "Reason", required: true, full: true },
        ] };
    case "leaveReview":
      return { title: "Review leave request", eyebrow: leave?.employee ?? "ABSENCE", action: "reviewLeave", success: "Leave decision recorded", extra: { leaveId: ctx.leaveId },
        fields: [
          { name: "decision", label: "Decision", type: "select", required: true, options: [["approved", "Approve"], ["rejected", "Reject"]] },
          { name: "note", label: "Review note", full: true },
        ] };
    case "review":
      return { title: "Review timesheet", eyebrow: approval?.employee ?? "APPROVAL", action: "reviewTimesheet", success: "Timesheet review saved", extra: { approvalId: ctx.approvalId },
        fields: [
          { name: "decision", label: "Decision", type: "select", required: true, options: [["approved", "Approve"], ["rejected", "Reject"]] },
          { name: "comment", label: "Reviewer comment", required: true, full: true },
        ] };
    case "org":
      return { title: "Organization preferences", eyebrow: "SETTINGS", action: "updateOrganization", success: "Organization updated", extra: {},
        fields: [
          { name: "name", label: "Organization name", required: true, full: true, defaultValue: data.organization.name },
          { name: "timezone", label: "Timezone", type: "select", required: true, options: TIMEZONES.map((zone) => [zone, zone]), defaultValue: data.organization.timezone },
          { name: "weekStartsOn", label: "Week starts on", type: "select", required: true, options: WEEK_STARTS, defaultValue: data.organization.weekStartsOn },
        ] };
    case "profile":
      return { title: "Profile preferences", eyebrow: "SETTINGS", action: "updateOwnProfile", success: "Profile updated", extra: {},
        fields: [
          { name: "name", label: "Full name", required: true, full: true, defaultValue: employee?.name },
          { name: "title", label: "Job title", required: true, full: true, defaultValue: employee?.title },
        ] };
  }
}



function FormModal({ spec, busy, close, submit }: { spec: FormSpec; busy: boolean; close: () => void; submit: (values: Record<string, unknown>) => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    formRef.current?.querySelector<HTMLElement>("input, select, button")?.focus();
    return () => previousFocus?.focus();
  }, []);

  function onDialogKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(formRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)") ?? []);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(event.currentTarget).entries());
    const values: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      const text = String(value);
      if (text !== "") values[key] = text;
    }
    submit(values);
  }

  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <button className="modal-scrim" onClick={close} aria-label="Close dialog" />
      <form ref={formRef} className="modal glass-regular" onSubmit={onSubmit} onKeyDown={onDialogKeyDown}>
        <header>
          <div><span>{spec.eyebrow}</span><h2 id="modal-title">{spec.title}</h2></div>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="form-body">
          {spec.fields.map((field) => <FieldInput key={field.name} field={field} />)}
        </div>
        <footer>
          <button type="button" className="secondary-btn" onClick={close}>Cancel</button>
          <button className="primary-btn" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </footer>
      </form>
    </div>
  );
}

function FieldInput({ field }: { field: Field }) {
  const id = `field-${field.name}`;
  return (
    <label className="field" data-full={field.full ? "true" : undefined} htmlFor={id}>
      <span>{field.label}</span>
      {field.type === "select" ? (
        <select id={id} name={field.name} required={field.required} defaultValue={field.defaultValue === undefined ? undefined : String(field.defaultValue)}>
          {field.options?.map(([value, label]) => <option value={String(value)} key={String(value)}>{label}</option>)}
        </select>
      ) : (
        <input
          id={id} name={field.name} type={field.type ?? "text"} required={field.required} step={field.step}
          placeholder={field.placeholder} defaultValue={field.defaultValue}
        />
      )}
    </label>
  );
}

/* -------------------------------- primitives ------------------------------- */

function Panel({ title, meta, children, className = "", action }: { title: string; meta: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={`panel ${className}`}>
      <header>
        <div><h2>{title}</h2><span>{meta}</span></div>
        {action ?? <span className="panel-header-mark" aria-hidden="true" />}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

function FilterBar({ children }: { children: ReactNode }) {
  return <div className="filter-bar">{children}</div>;
}

function FilterSelect<T extends string | number>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (value: T) => void; options: Array<[T, string]>;
}) {
  return (
    <label className="filter-select">
      <span>{label}</span>
      <select value={String(value)} onChange={(event) => onChange((typeof value === "number" ? Number(event.target.value) : event.target.value) as T)}>
        {options.map(([option, text]) => <option value={String(option)} key={String(option)}>{text}</option>)}
      </select>
      <ChevronDown size={13} />
    </label>
  );
}

function Avatar({ name, color }: { name: string; color?: string }) {
  return <span className="avatar" style={{ "--avatar": color ?? "#3a3d42" } as React.CSSProperties}>{initials(name)}</span>;
}

function Status({ value }: { value: string }) {
  return <span className={`status ${value}`}>{value.replace(/_/g, " ")}</span>;
}

function Empty({ title, text }: { title: string; text: string }) {
  return <div className="empty"><Check size={18} /><b>{title}</b><span>{text}</span></div>;
}

function averageProgress(tasks: WorkspaceData["tasks"]): number {
  return Math.round(tasks.reduce((sum, task) => sum + task.progress, 0) / Math.max(1, tasks.length));
}

type StateFilters = { employee: number; team: number; project: number; status: string; range: number };

function filterEmployees(rows: EmployeeRow[], search: string, filters: StateFilters): EmployeeRow[] {
  const query = search.trim().toLowerCase();
  return rows.filter((row) => {
    const matchesQuery = !query || `${row.name} ${row.email} ${row.title} ${row.team ?? ""}`.toLowerCase().includes(query);
    const matchesTeam = !filters.team || row.teamId === filters.team;
    const matchesStatus = filters.status === "all" || row.status === filters.status;
    return matchesQuery && matchesTeam && matchesStatus;
  });
}

function filterAttendance(rows: WorkspaceData["attendance"], search: string, filters: StateFilters, today: string): WorkspaceData["attendance"] {
  const query = search.trim().toLowerCase();
  return rows.filter((row) => {
    const matchesQuery = !query || row.employee.toLowerCase().includes(query);
    const matchesEmployee = !filters.employee || row.employeeId === filters.employee;
    const matchesRange = filters.range === 0 || row.workDate >= shiftDays(today, -(filters.range - 1));
    return matchesQuery && matchesEmployee && matchesRange;
  });
}

function shiftDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
