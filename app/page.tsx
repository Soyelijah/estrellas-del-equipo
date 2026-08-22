"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { allocateTipPoolByExperienceFactors, formatExperienceFactor } from "../domain/tips";

type View = "inicio" | "equipo" | "evaluaciones" | "acuerdo";
type Account = { displayName: string; role: string };
type StoredUser = { id: string; displayName: string; loginIdentifier: string; status: string; role: string; jobTitle: keyof typeof jobTitles; tipFactorHundredths: number };
type AuthState = { loading: boolean; bootstrapAllowed: boolean; setupUnlocked: boolean; account: Account | null; users: StoredUser[]; unavailable: boolean };

const jobTitles = {
  head_waiter: "Jefe de garzones",
  waiter: "Garzón",
  bartender: "Barman",
  cashier: "Cajera",
} as const;
const clpFormatter = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

function initials(label: string) {
  return label.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

export default function Home() {
  const [view, setView] = useState<View>("inicio");
  const [tipPoolPesos, setTipPoolPesos] = useState(0);
  const [auth, setAuth] = useState<AuthState>({ loading: true, bootstrapAllowed: false, setupUnlocked: false, account: null, users: [], unavailable: false });
  const [accountMessage, setAccountMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function refreshAuth() {
    try {
      const response = await fetch("/api/auth/status", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("unavailable");
      const data = await response.json() as Omit<AuthState, "loading" | "unavailable">;
      setAuth({ loading: false, bootstrapAllowed: data.bootstrapAllowed, setupUnlocked: data.setupUnlocked, account: data.account, users: data.users, unavailable: false });
    } catch {
      setAuth((current) => ({ ...current, loading: false, unavailable: true }));
    }
  }

  useEffect(() => {
    let active = true;
    fetch("/api/auth/status", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return response.json() as Promise<Omit<AuthState, "loading" | "unavailable">>;
      })
      .then((data) => {
        if (active) setAuth({ loading: false, bootstrapAllowed: data.bootstrapAllowed, setupUnlocked: data.setupUnlocked, account: data.account, users: data.users, unavailable: false });
      })
      .catch(() => {
        if (active) setAuth((current) => ({ ...current, loading: false, unavailable: true }));
      });
    return () => { active = false; };
  }, []);

  async function submitAccount(event: FormEvent<HTMLFormElement>, path: string) {
    event.preventDefault();
    setSubmitting(true);
    setAccountMessage("");
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    try {
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as { ok: boolean; error?: string };
      if (!response.ok) {
        const messages: Record<string, string> = {
          invalid_account_data: "Revisa los datos. El usuario debe tener al menos 3 caracteres y la contraseña al menos 12.",
          invalid_credentials: "Usuario o contraseña incorrectos.",
          login_identifier_exists: "Ese usuario ya existe.",
          bootstrap_closed: "La cuenta administradora ya fue activada.",
          invalid_access_key: "La clave de acceso no es válida.",
          setup_access_required: "Valida primero la clave única de activación.",
          setup_access_unavailable: "La clave única todavía no está configurada en el servidor.",
        };
        setAccountMessage(messages[result.error ?? ""] ?? "No fue posible guardar la cuenta.");
        return;
      }
      form.reset();
      setAccountMessage(path === "/api/admin/users" ? "Cuenta creada y guardada en la base de datos." : path === "/api/auth/bootstrap/unlock" ? "Clave validada. Completa ahora la cuenta administradora." : path === "/api/auth/bootstrap" ? "Cuenta creada. Inicia sesión para entrar." : "Sesión iniciada.");
      await refreshAuth();
    } catch {
      setAccountMessage("No se pudo conectar con la base de datos local.");
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" });
    setAccountMessage("");
    await refreshAuth();
  }
  const realTeam = auth.users;
  const totalFactorHundredths = realTeam.reduce((sum, member) => sum + member.tipFactorHundredths, 0);
  const evaluatorCount = realTeam.length;
  const evaluationSubjectCount = realTeam.filter(({ jobTitle }) => jobTitle !== "cashier").length;
  const tipSimulation = useMemo(
    () => realTeam.length === 0 ? [] : allocateTipPoolByExperienceFactors(
      tipPoolPesos,
      realTeam.map(({ id, tipFactorHundredths }) => ({ participantId: id, factorHundredths: tipFactorHundredths })),
    ),
    [tipPoolPesos, realTeam],
  );

  if (auth.loading) {
    return (
      <main className="access-shell access-loading" aria-busy="true">
        <div className="access-brand"><span className="brand-mark">☆</span><div><strong>Estrellas</strong><span>del Equipo</span></div></div>
        <p>Preparando el acceso…</p>
      </main>
    );
  }

  if (auth.unavailable) {
    return (
      <main className="access-shell">
        <div className="access-brand"><span className="brand-mark">☆</span><div><strong>Estrellas</strong><span>del Equipo</span></div></div>
        <section className="access-problem" role="alert"><span>!</span><h1>No se pudo abrir el acceso</h1><p>La base de datos local no está respondiendo. Reinicia el servidor y vuelve a intentarlo.</p><button className="primary" onClick={() => void refreshAuth()}>Volver a intentar</button></section>
      </main>
    );
  }

  if (!auth.account) {
    return (
      <main className="access-shell premium-access">
        <div className="access-aurora" aria-hidden="true" />
        <div className="access-constellation" aria-hidden="true">{Array.from({ length: 7 }, (_, index) => <i key={index} />)}</div>
        <header className="access-header"><div className="access-brand"><span className="brand-mark">☆</span><div><strong>Estrellas</strong><span>del Equipo</span></div></div><span>Acceso del equipo</span></header>
        <section className="access-stage">
          <div className="access-intro">
            <span className="access-kicker">{auth.bootstrapAllowed ? "Apertura protegida" : "Bienvenido de vuelta"}</span>
            <h1>{auth.bootstrapAllowed ? "La puerta del equipo se abre una sola vez." : "Tu jornada empieza aquí."}</h1>
            <p>{auth.bootstrapAllowed ? "Primero valida la clave única del sistema. Después podrás registrar la cuenta de quien administrará el equipo." : "Entra con tu cuenta personal. Tu identidad mantiene cada acción y evaluación correctamente atribuida."}</p>
            <div className="access-trust"><span>Contraseña protegida</span><span>Sesión privada</span><span>Una cuenta por persona</span></div>
          </div>
          {auth.bootstrapAllowed && !auth.setupUnlocked ? (
            <form className="access-form setup-key-form" onSubmit={(event) => void submitAccount(event, "/api/auth/bootstrap/unlock")} aria-labelledby="setup-key-title">
              <div className="access-form-heading"><span className="form-emblem">✦</span><div><span className="section-kicker">PASO 1 DE 2</span><h2 id="setup-key-title">Clave única de acceso</h2><p>Solo quien posea esta clave puede abrir el registro administrativo.</p></div></div>
              <label>Clave de activación<div className="secret-input"><input name="accessKey" type={showPassword ? "text" : "password"} required minLength={20} maxLength={200} autoComplete="one-time-code" autoFocus /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Ocultar clave" : "Mostrar clave"}>{showPassword ? "Ocultar" : "Ver"}</button></div></label>
              <div className="key-assurance"><span>Uso único</span><span>Validación en servidor</span><span>No se guarda en el navegador</span></div>
              <button className="access-submit" disabled={submitting}><span>{submitting ? "Validando…" : "Validar y continuar"}</span><b>→</b></button>
              {accountMessage && <p className="form-message" role="status">{accountMessage}</p>}
            </form>
          ) : auth.bootstrapAllowed ? (
            <form className="access-form" onSubmit={(event) => void submitAccount(event, "/api/auth/bootstrap")} aria-labelledby="bootstrap-title">
              <div className="access-form-heading"><span className="form-emblem success-emblem">✓</span><div><span className="section-kicker">PASO 2 DE 2</span><h2 id="bootstrap-title">Cuenta administradora</h2><p>Clave validada. Esta activación se cerrará al guardar.</p></div></div>
              <label>Nombre del restaurante<input name="organizationName" required minLength={2} maxLength={120} autoComplete="organization" /></label>
              <label>Tu nombre o alias<input name="displayName" required minLength={2} maxLength={100} autoComplete="name" /></label>
              <label>Usuario<input name="loginIdentifier" required minLength={3} maxLength={80} autoComplete="username" spellCheck={false} /></label>
              <label>Contraseña<div className="secret-input"><input name="password" type={showPassword ? "text" : "password"} required minLength={12} maxLength={128} autoComplete="new-password" /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>{showPassword ? "Ocultar" : "Ver"}</button></div></label>
              <small>Usa al menos 12 caracteres y no compartas esta contraseña.</small>
              <button className="access-submit" disabled={submitting}><span>{submitting ? "Creando cuenta…" : "Crear cuenta administradora"}</span><b>→</b></button>
              {accountMessage && <p className="form-message" role="status">{accountMessage}</p>}
            </form>
          ) : (
            <form className="access-form" onSubmit={(event) => void submitAccount(event, "/api/auth/login")} aria-labelledby="login-title">
              <div className="access-form-heading"><span className="form-emblem">☆</span><div><span className="section-kicker">ACCESO PERSONAL</span><h2 id="login-title">Iniciar sesión</h2><p>Tu usuario identifica tus evaluaciones y acciones.</p></div></div>
              <label>Usuario<input name="loginIdentifier" required autoComplete="username" autoFocus /></label>
              <label>Contraseña<div className="secret-input"><input name="password" type={showPassword ? "text" : "password"} required autoComplete="current-password" /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>{showPassword ? "Ocultar" : "Ver"}</button></div></label>
              <button className="access-submit" disabled={submitting}><span>{submitting ? "Comprobando acceso…" : "Entrar al sistema"}</span><b>→</b></button>
              {accountMessage && <p className="form-message" role="status">{accountMessage}</p>}
            </form>
          )}
        </section>
        <footer className="access-footer"><span>Uso interno del equipo</span><span>Los resultados solo se generan con registros reales.</span></footer>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">☆</span><div><strong>Estrellas</strong><span>del Equipo</span></div></div>
        <nav aria-label="Navegación principal">
          <button className={view === "inicio" ? "active" : ""} onClick={() => setView("inicio")}><span>⌂</span>Inicio</button>
          <button className={view === "equipo" ? "active" : ""} onClick={() => setView("equipo")}><span>♙</span>Equipo</button>
          <button className={view === "evaluaciones" ? "active" : ""} onClick={() => setView("evaluaciones")}><span>☆</span>Evaluaciones</button>
          <button className={view === "acuerdo" ? "active" : ""} onClick={() => setView("acuerdo")}><span>♢</span>Propinas</button>
        </nav>
        <div className="sidebar-note verified-note"><span>Datos reales</span><p>El equipo y sus factores se muestran únicamente después de guardarlos en la base de datos.</p></div>
        <div className="profile pending-profile"><div className="avatar small neutral-avatar">{auth.account ? initials(auth.account.displayName) : "—"}</div><div><strong>{auth.account?.displayName ?? "Sin sesión iniciada"}</strong><span>{auth.account ? (auth.account.role === "admin" ? "Administrador" : "Trabajador") : "Acceso personal"}</span></div>{auth.account && <button className="logout-button" onClick={() => void logout()}>Salir</button>}</div>
      </aside>

      <section className="content">
        <div className="data-banner" role="status"><strong>{auth.account ? "Sesión real activa" : "Configuración confirmada"}</strong><span>{auth.account ? `${auth.account.displayName} está conectado a la base de datos.` : "Sin puntajes, turnos, identidades ni recompensas inventadas."}</span></div>
        <header className="topbar"><div><p className="eyebrow">ESTADO REAL DEL SISTEMA</p><h1>Equipo y acuerdo de propinas</h1></div><span className="status neutral">Configuración inicial</span></header>

        {view === "inicio" && (
          <>
            <section className="hero real-data-hero">
              <div className="hero-copy">
                <span className="pill olive">Base acordada lista</span>
                <h2>Primero la verdad de los datos.</h2>
                <p>La aplicación conserva únicamente los cargos, permisos de evaluación y factores de experiencia confirmados. Hasta que existan cuentas y turnos reales, no se mostrarán evaluaciones ni resultados.</p>
                <button className="primary" onClick={() => setView("equipo")}>Revisar configuración <span>→</span></button>
                <div className="privacy-line"><span>✓</span> Sin notas simuladas · Sin rankings ficticios · Sin consecuencias automáticas</div>
              </div>
              <div className="setup-card">
                <span className="setup-icon">◎</span><strong>Falta activar la operación</strong>
                <p>Se deben crear las cuentas, registrar un turno y abrir un período antes de evaluar.</p>
                <div className="setup-steps"><span className="done">✓ Acuerdo del equipo</span><span>○ Cuentas personales</span><span>○ Primer turno</span><span>○ Primera evaluación</span></div>
              </div>
            </section>
            <section className="metric-grid real-metrics">
              <article><div className="metric-icon coral">♙</div><div><span>Trabajadores registrados</span><strong>{realTeam.length}</strong><small>Cuentas creadas por ti</small></div></article>
              <article><div className="metric-icon olive">✓</div><div><span>Pueden evaluar</span><strong>{evaluatorCount}</strong><small>Según cuentas activas</small></div></article>
              <article><div className="metric-icon blue">☆</div><div><span>Pueden ser evaluados</span><strong>{evaluationSubjectCount}</strong><small>La cajera queda fuera</small></div></article>
              <article><div className="metric-icon gold">◎</div><div><span>Factores totales</span><strong>{formatExperienceFactor(totalFactorHundredths)}</strong><small>Puntos de experiencia</small></div></article>
            </section>
            <section className="two-column">
              <article className="panel empty-summary"><div className="panel-head"><div><span className="section-kicker">EVALUACIONES</span><h3>Aún no hay evaluaciones registradas</h3></div></div><p>Cuando un usuario real complete una evaluación correspondiente a un turno registrado, su estado aparecerá aquí. No se calcula ningún resultado con datos de ejemplo.</p></article>
              <article className="panel empty-summary"><div className="panel-head"><div><span className="section-kicker">ACTIVACIÓN</span><h3>Datos necesarios para comenzar</h3></div></div><ul className="clean-list"><li>Nombre o alias definitivo de cada trabajador.</li><li>Cuenta personal y acceso seguro.</li><li>Fecha, horario y participantes del turno.</li><li>Período y criterios aprobados.</li></ul></article>
            </section>
          </>
        )}

        {view === "equipo" && (
          <section className="data-section">
            <div className="section-heading"><div><p className="eyebrow">REGISTROS DE LA BASE DE DATOS</p><h2>Equipo</h2><span>Solo aparecen las cuentas que tú hayas creado con sus datos y factor acordado.</span></div><span className="status complete">{realTeam.length} trabajadores</span></div>
            {realTeam.length === 0 ? <div className="empty-state compact-empty" role="status"><span className="empty-icon">♙</span><h3>Aún no has agregado trabajadores</h3><p>Crea la primera cuenta con su nombre, cargo, credenciales y porcentaje de experiencia.</p></div> : <div className="team-table-wrap"><table className="team-table"><caption>Trabajadores reales guardados</caption><thead><tr><th scope="col">Trabajador</th><th scope="col">Cargo</th><th scope="col">Factor</th><th scope="col">Evalúa</th><th scope="col">Es evaluado</th></tr></thead><tbody>
              {realTeam.map((member) => { const canBeEvaluated = member.jobTitle !== "cashier"; return <tr key={member.id}><td><span className="avatar tiny">{initials(member.displayName)}</span><strong>{member.displayName}</strong></td><td>{jobTitles[member.jobTitle]}</td><td><strong>{formatExperienceFactor(member.tipFactorHundredths)}</strong></td><td><span className="permission yes">Sí</span></td><td><span className={canBeEvaluated ? "permission yes" : "permission no"}>{canBeEvaluated ? "Sí" : "No"}</span></td></tr>; })}
            </tbody></table></div>}
            {auth.account?.role === "admin" && (
              <div className="account-admin-grid">
                <form className="panel account-form" onSubmit={(event) => void submitAccount(event, "/api/admin/users")}>
                  <div><span className="section-kicker">ADMINISTRACIÓN</span><h3>Crear una cuenta real</h3><p>El trabajador podrá entrar con este usuario y contraseña.</p></div>
                  <label>Nombre o alias<input name="displayName" required minLength={2} maxLength={100} autoComplete="off" /></label>
                  <label>Usuario<input name="loginIdentifier" required minLength={3} maxLength={80} autoComplete="off" spellCheck={false} /></label>
                  <label>Cargo<select name="jobTitle" defaultValue="waiter"><option value="waiter">Garzón</option><option value="bartender">Barman</option><option value="cashier">Cajera</option><option value="head_waiter">Jefe de garzones</option></select></label>
                  <label>Porcentaje de experiencia<input name="tipPercentage" type="number" required min={1} max={100} step={1} inputMode="numeric" placeholder="Ej: 65" /><small>100% = 1,00 punto · 65% = 0,65 puntos</small></label>
                  <label>Contraseña inicial<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
                  <button className="primary full" disabled={submitting}>{submitting ? "Guardando…" : "Crear cuenta"}</button>
                  {accountMessage && <p className="form-message" role="status">{accountMessage}</p>}
                </form>
                <article className="panel stored-users"><div><span className="section-kicker">BASE DE DATOS</span><h3>Cuentas guardadas</h3></div>{auth.users.length === 0 ? <p>No hay cuentas visibles.</p> : <ul>{auth.users.map((user) => <li key={user.id}><span className="avatar tiny">{initials(user.displayName)}</span><div><strong>{user.displayName}</strong><small>@{user.loginIdentifier} · {jobTitles[user.jobTitle] ?? user.jobTitle}</small></div><span className="permission yes">Activa</span></li>)}</ul>}</article>
              </div>
            )}
          </section>
        )}

        {view === "evaluaciones" && (
          <section className="data-section">
            <div className="section-heading"><div><p className="eyebrow">REGISTROS REALES</p><h2>Evaluaciones</h2><span>Esta sección permanecerá vacía hasta que exista un turno válido y una cuenta autenticada.</span></div></div>
            <div className="empty-state" role="status"><span className="empty-icon">☆</span><h3>Aún no hay evaluaciones registradas</h3><p>No se muestran estrellas, promedios ni tendencias porque todavía no existen observaciones reales guardadas.</p><div className="empty-requirements"><span>Cuenta autenticada</span><span>Turno compartido</span><span>Período abierto</span></div></div>
          </section>
        )}

        {view === "acuerdo" && (
          <section className="data-section">
            <div className="section-heading"><div><p className="eyebrow">TRABAJADORES REGISTRADOS</p><h2>Factores de propina</h2><span>Cada factor proviene del porcentaje guardado al crear la cuenta: 100% equivale a 1,00 punto.</span></div><span className="status complete">Total {formatExperienceFactor(totalFactorHundredths)}</span></div>
            <div className="tip-simulator">
              <div className="tip-simulator-head"><div><span className="section-kicker">CALCULADORA</span><h3>Distribución por factores</h3><p>Ingresa el fondo real del turno. El valor comienza en cero y no se guarda todavía.</p></div><label><span>Fondo común</span><div className="money-input"><b>$</b><input type="number" min="0" step="1" value={tipPoolPesos} onChange={(event) => setTipPoolPesos(Math.max(0, Math.trunc(Number(event.target.value) || 0)))} aria-label="Fondo común de propinas en pesos chilenos" /></div></label></div>
              {realTeam.length === 0 ? <div className="calculator-empty">Agrega trabajadores antes de calcular una distribución.</div> : tipPoolPesos === 0 ? <div className="calculator-empty">Ingresa el monto real de propinas para calcular la distribución.</div> : <div className="tip-simulation-grid">{realTeam.map((member) => { const result = tipSimulation.find(({ participantId }) => participantId === member.id); return <article key={member.id}><span>{member.displayName}</span><strong>{clpFormatter.format(result?.amountPesos ?? 0)}</strong><small>Factor {formatExperienceFactor(member.tipFactorHundredths)}</small></article>; })}</div>}
              {realTeam.length > 0 && <div className="formula-note"><strong>Fórmula:</strong> monto ÷ {formatExperienceFactor(totalFactorHundredths)} × factor individual. La calculadora distribuye cada peso mediante redondeo determinista.</div>}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
