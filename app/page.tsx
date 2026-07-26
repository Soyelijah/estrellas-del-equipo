"use client";

import { useMemo, useState } from "react";

type Role = "worker" | "admin";
type View = "inicio" | "valorar" | "resultados" | "recompensas";
type RatingMap = Record<string, Record<string, number>>;

const colleagues = [
  { id: "maria", name: "María López", role: "Garzona", shift: "Salón", initials: "ML", color: "coral" },
  { id: "carlos", name: "Carlos Ramírez", role: "Bartender", shift: "Barra", initials: "CR", color: "olive" },
  { id: "ana", name: "Ana Torres", role: "Cocina", shift: "Cocina", initials: "AT", color: "gold" },
  { id: "diego", name: "Diego Soto", role: "Runner", shift: "Salón", initials: "DS", color: "blue" },
];

const criteria = [
  { id: "team", label: "Trabajo en equipo", hint: "Coopera y aporta al objetivo común" },
  { id: "attitude", label: "Actitud", hint: "Mantiene respeto y buena disposición" },
  { id: "support", label: "Apoyo en turno", hint: "Ayuda cuando el equipo lo necesita" },
  { id: "service", label: "Calidad de servicio", hint: "Cuida cada detalle con el cliente" },
];

const monthly = [
  { name: "María López", initials: "ML", section: "Salón", team: 4.9, attitude: 4.8, support: 4.9, service: 4.7, total: 4.83, status: "Premiable" },
  { name: "Carlos Ramírez", initials: "CR", section: "Barra", team: 4.7, attitude: 4.9, support: 4.6, service: 4.8, total: 4.75, status: "Premiable" },
  { name: "Ana Torres", initials: "AT", section: "Cocina", team: 4.8, attitude: 4.6, support: 4.8, service: 4.7, total: 4.73, status: "En curso" },
  { name: "Diego Soto", initials: "DS", section: "Salón", team: 4.4, attitude: 4.5, support: 4.7, service: 4.5, total: 4.53, status: "En curso" },
  { name: "Daniela Rojas", initials: "DR", section: "Salón", team: 4.7, attitude: 4.8, support: 4.6, service: 4.9, total: 4.75, status: "Premiable" },
];

function StarRating({ value, onChange, label }: { value: number; onChange: (value: number) => void; label: string }) {
  return (
    <div className="stars" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          className={star <= value ? "star active" : "star"}
          onClick={() => onChange(star)}
          role="radio"
          aria-checked={star === value}
          aria-label={`${star} de 5`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function ProgressRing({ value }: { value: number }) {
  return (
    <div className="progress-ring" style={{ "--progress": `${value * 3.6}deg` } as React.CSSProperties}>
      <span>{value}%</span>
    </div>
  );
}

export default function Home() {
  const [role, setRole] = useState<Role>("worker");
  const [view, setView] = useState<View>("inicio");
  const [ratings, setRatings] = useState<RatingMap>({
    maria: { team: 5, attitude: 4, support: 5, service: 0 },
  });
  const [submitted, setSubmitted] = useState(false);
  const [selectedSection, setSelectedSection] = useState("Todas");

  const completed = useMemo(
    () => colleagues.filter((person) => criteria.every((criterion) => (ratings[person.id]?.[criterion.id] ?? 0) > 0)).length,
    [ratings],
  );
  const totalFields = colleagues.length * criteria.length;
  const ratedFields = Object.values(ratings).reduce(
    (sum, person) => sum + criteria.filter((criterion) => (person[criterion.id] ?? 0) > 0).length,
    0,
  );
  const completion = Math.round((ratedFields / totalFields) * 100);

  const setRating = (person: string, criterion: string, value: number) => {
    setSubmitted(false);
    setRatings((current) => ({
      ...current,
      [person]: { ...(current[person] ?? {}), [criterion]: value },
    }));
  };

  const filteredMonthly = selectedSection === "Todas"
    ? monthly
    : monthly.filter((person) => person.section === selectedSection);

  const changeRole = (nextRole: Role) => {
    setRole(nextRole);
    setView("inicio");
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">☆</span>
          <div><strong>Estrellas</strong><span>del Equipo</span></div>
        </div>

        <div className="role-switch" aria-label="Vista de demostración">
          <button className={role === "worker" ? "active" : ""} onClick={() => changeRole("worker")}>Trabajador</button>
          <button className={role === "admin" ? "active" : ""} onClick={() => changeRole("admin")}>Administrador</button>
        </div>

        <nav>
          <button className={view === "inicio" ? "active" : ""} onClick={() => setView("inicio")}><span>⌂</span>Inicio</button>
          {role === "worker" && (
            <>
              <button className={view === "valorar" ? "active" : ""} onClick={() => setView("valorar")}><span>☆</span>Valoración diaria <b>{completed}/{colleagues.length}</b></button>
              <button className={view === "resultados" ? "active" : ""} onClick={() => setView("resultados")}><span>◌</span>Mis resultados</button>
              <button className={view === "recompensas" ? "active" : ""} onClick={() => setView("recompensas")}><span>♢</span>Recompensas</button>
            </>
          )}
          {role === "admin" && (
            <>
              <button className={view === "resultados" ? "active" : ""} onClick={() => setView("resultados")}><span>▦</span>Equipo y promedios</button>
              <button className={view === "recompensas" ? "active" : ""} onClick={() => setView("recompensas")}><span>♢</span>Reglas y bonos</button>
            </>
          )}
        </nav>

        <div className="sidebar-note">
          <span>Privado y respetuoso</span>
          <p>Las opiniones individuales nunca muestran quién valoró a quién.</p>
        </div>
        <div className="profile">
          <div className="avatar small">{role === "admin" ? "JS" : "DR"}</div>
          <div><strong>{role === "admin" ? "Javier Silva" : "Daniela Rojas"}</strong><span>{role === "admin" ? "Jefe · Administrador" : "Garzona · Turno PM"}</span></div>
          <button aria-label="Abrir menú de cuenta">•••</button>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">{role === "admin" ? "Panel de administración" : "Domingo, 26 de julio · Turno PM"}</p>
            <h1>{role === "admin" ? "Resumen del equipo" : view === "valorar" ? "Valoración diaria" : `Buenas tardes, Daniela`}</h1>
          </div>
          <div className="top-actions">
            <button className="icon-button" aria-label="Notificaciones">♢<i /></button>
            {role === "worker" && view !== "valorar" && <button className="primary" onClick={() => setView("valorar")}>★ Valorar ahora</button>}
            {role === "admin" && <button className="outline">↓ Exportar informe</button>}
          </div>
        </header>

        {role === "worker" && view === "inicio" && (
          <>
            <section className="hero">
              <div className="hero-copy">
                <span className="pill olive">Reconocimiento diario</span>
                <h2>Tu opinión hace crecer al equipo.</h2>
                <p>Antes de cerrar tu turno, valora a cada compañero con quien trabajaste hoy. Son 4 criterios, toma menos de 3 minutos.</p>
                <button className="primary" onClick={() => setView("valorar")}>{completed === colleagues.length ? "Revisar valoración" : "Completar valoración"} <span>→</span></button>
                <div className="privacy-line"><span>✓</span> Resultados anónimos · Sin autoevaluación · Promedio mensual</div>
              </div>
              <div className="hero-visual">
                {/* Vinext serves this local production asset directly. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/equipo-restaurante.png"
                  alt="Equipo de un restaurante reunido al final de su turno"
                />
                <div className="floating-card"><strong>{completed} de {colleagues.length}</strong><span>compañeros listos hoy</span></div>
              </div>
            </section>

            <section className="metric-grid">
              <article><div className="metric-icon coral">★</div><div><span>Mi promedio mensual</span><strong>4.75</strong><small>↑ 0.18 vs. junio</small></div></article>
              <article><div className="metric-icon olive">✓</div><div><span>Días completados</span><strong>22 / 24</strong><small>92% de cumplimiento</small></div></article>
              <article><div className="metric-icon gold">$</div><div><span>Bono proyectado</span><strong>+3%</strong><small>Propina del mes</small></div></article>
              <article><div className="metric-icon blue">◷</div><div><span>Descanso ganado</span><strong>40 min</strong><small>Faltan 20 min</small></div></article>
            </section>

            <section className="two-column">
              <article className="panel">
                <div className="panel-head"><div><span className="section-kicker">HOY</span><h3>Tu tarea pendiente</h3></div><span className="status pending">Obligatoria</span></div>
                <div className="task-row">
                  <ProgressRing value={completion} />
                  <div><strong>Valoración del turno PM</strong><p>{ratedFields} de {totalFields} respuestas completadas</p><div className="mini-progress"><i style={{ width: `${completion}%` }} /></div></div>
                  <button className="text-button" onClick={() => setView("valorar")}>Continuar →</button>
                </div>
              </article>
              <article className="panel">
                <div className="panel-head"><div><span className="section-kicker">ESTE MES</span><h3>Tu próxima recompensa</h3></div></div>
                <div className="reward-compact"><span className="reward-icon">♛</span><div><strong>Empleado del mes</strong><p>Estás entre los 3 mejores puntajes elegibles</p></div><span className="big-score">4.75</span></div>
              </article>
            </section>
          </>
        )}

        {role === "worker" && view === "valorar" && (
          <section className="rating-layout">
            <div className="rating-main">
              <div className="notice">
                <span>!</span>
                <div><strong>Evaluación obligatoria antes de cerrar el turno</strong><p>Valora solo conductas que observaste hoy. Si no trabajaste con alguien, informa al jefe de turno.</p></div>
                <b>{completion}%</b>
              </div>
              <div className="section-heading">
                <div><p className="eyebrow">TURNO PM · 26 JULIO</p><h2>Valora a tus compañeros</h2><span>Cada criterio se responde por separado.</span></div>
                <div className="legend"><i /> Pendiente <i className="done" /> Completo</div>
              </div>
              <div className="colleague-list">
                {colleagues.map((person, index) => {
                  const isDone = criteria.every((criterion) => (ratings[person.id]?.[criterion.id] ?? 0) > 0);
                  return (
                    <article className={isDone ? "rating-card complete" : "rating-card"} key={person.id}>
                      <div className="person-row">
                        <div className={`avatar ${person.color}`}>{person.initials}</div>
                        <div><strong>{person.name}</strong><span>{person.role} · {person.shift}</span></div>
                        <span className={isDone ? "status complete" : "status pending"}>{isDone ? "✓ Completo" : `${index + 1} · Pendiente`}</span>
                      </div>
                      <div className="criteria-grid">
                        {criteria.map((criterion) => (
                          <div className="criterion" key={criterion.id}>
                            <label>{criterion.label}<small>{criterion.hint}</small></label>
                            <StarRating
                              label={`${criterion.label} de ${person.name}`}
                              value={ratings[person.id]?.[criterion.id] ?? 0}
                              onChange={(value) => setRating(person.id, criterion.id, value)}
                            />
                          </div>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
            <aside className="submit-panel">
              <span className="section-kicker">PROGRESO DE HOY</span>
              <ProgressRing value={completion} />
              <h3>{completed} de {colleagues.length} compañeros</h3>
              <p>Completa los {criteria.length} criterios de cada persona.</p>
              <div className="check-list">
                {colleagues.map((person) => {
                  const done = criteria.every((criterion) => (ratings[person.id]?.[criterion.id] ?? 0) > 0);
                  return <span key={person.id} className={done ? "done" : ""}><i>{done ? "✓" : "○"}</i>{person.name}</span>;
                })}
              </div>
              <button
                className="primary full"
                disabled={completed !== colleagues.length}
                onClick={() => setSubmitted(true)}
              >
                Enviar valoración diaria
              </button>
              {submitted && <div className="success-message">✓ Valoración enviada. Gracias por reconocer a tu equipo.</div>}
              <small className="lock-note">▣ Una vez enviada, solo un administrador puede reabrirla.</small>
            </aside>
          </section>
        )}

        {role === "worker" && view === "resultados" && (
          <>
            <section className="results-hero">
              <div><span className="pill olive">Julio 2026</span><h2>Tu crecimiento, criterio por criterio</h2><p>Estos promedios reúnen todas las valoraciones válidas que recibiste este mes.</p></div>
              <div className="overall-score"><span>Promedio general</span><strong>4.75</strong><div>★★★★★</div><small>18 compañeros evaluaron</small></div>
            </section>
            <section className="criteria-results">
              {[
                ["Trabajo en equipo", "4.7", "94%", "+0.2"],
                ["Actitud", "4.8", "96%", "+0.1"],
                ["Apoyo en turno", "4.6", "92%", "+0.3"],
                ["Calidad de servicio", "4.9", "98%", "+0.2"],
              ].map(([label, score, percent, change]) => (
                <article key={label}><span>{label}</span><strong>{score}</strong><div className="mini-progress"><i style={{ width: percent }} /></div><small>↑ {change} este mes</small></article>
              ))}
            </section>
            <section className="two-column">
              <article className="panel"><div className="panel-head"><h3>Evolución mensual</h3><span className="status complete">Tendencia positiva</span></div><div className="chart"><div className="chart-line">●<span>●</span><b>●</b><em>●</em><i>●</i></div><div className="chart-labels"><span>Mar</span><span>Abr</span><span>May</span><span>Jun</span><span>Jul</span></div></div></article>
              <article className="panel feedback"><span className="quote">“</span><h3>Lo que más reconoce el equipo</h3><p>“Siempre está atenta a las mesas de los demás cuando el salón se llena.”</p><small>Comentario anónimo verificado · Julio</small></article>
            </section>
          </>
        )}

        {role === "worker" && view === "recompensas" && (
          <>
            <section className="results-hero rewards">
              <div><span className="pill coral">Recompensas transparentes</span><h2>Tu esfuerzo se convierte en beneficios reales.</h2><p>El promedio se calcula al finalizar el mes y solo considera evaluaciones completas y válidas.</p></div>
              <div className="points"><span>Nivel actual</span><strong>Oro</strong><small>4.75 promedio</small></div>
            </section>
            <section className="reward-grid">
              {[
                ["+3% en propinas", "Promedio mensual de 4.70 o más", "Logrado", "100%"],
                ["$25.000 de bono", "Promedio de 4.80 + 95% de cumplimiento", "En progreso", "82%"],
                ["60 min de descanso", "24 días de evaluaciones completas", "40 min ganados", "67%"],
                ["Empleado del mes", "Mayor puntaje elegible + validación del jefe", "Top 3 actual", "76%"],
              ].map(([title, detail, status, progress]) => (
                <article key={title}><div className="reward-top"><span>★</span><b>{status}</b></div><h3>{title}</h3><p>{detail}</p><div className="mini-progress"><i style={{ width: progress }} /></div><small>{progress} del objetivo</small></article>
              ))}
            </section>
          </>
        )}

        {role === "admin" && view === "inicio" && (
          <>
            <section className="admin-overview">
              <div><span className="pill coral">Cierre mensual · faltan 5 días</span><h2>El equipo mantiene un alto nivel de colaboración.</h2><p>Revisa cumplimiento, tendencias y posibles anomalías antes de confirmar los bonos de julio.</p></div>
              <div className="month-picker">‹ <strong>Julio 2026</strong> ›</div>
            </section>
            <section className="metric-grid admin">
              <article><div className="metric-icon coral">★</div><div><span>Promedio del equipo</span><strong>4.72</strong><small>↑ 0.14 vs. junio</small></div></article>
              <article><div className="metric-icon olive">✓</div><div><span>Cumplimiento diario</span><strong>94%</strong><small>226 de 240 completas</small></div></article>
              <article><div className="metric-icon gold">$</div><div><span>Bonos proyectados</span><strong>$175.000</strong><small>7 trabajadores elegibles</small></div></article>
              <article><div className="metric-icon blue">!</div><div><span>Alertas por revisar</span><strong>3</strong><small>Patrones atípicos detectados</small></div></article>
            </section>
            <section className="admin-grid">
              <article className="panel compliance">
                <div className="panel-head"><div><span className="section-kicker">HOY · TURNO PM</span><h3>Cumplimiento de valoraciones</h3></div><button className="text-button">Ver detalle →</button></div>
                <div className="compliance-body"><ProgressRing value={83} /><div><strong>20 de 24 trabajadores completaron</strong><p>4 pendientes · Cierre automático a las 23:59</p><div className="pending-people">{["ML", "CR", "AT", "DS"].map((name) => <span key={name}>{name}</span>)}</div></div></div>
              </article>
              <article className="panel alerts">
                <div className="panel-head"><div><span className="section-kicker">CONTROL DE EQUIDAD</span><h3>Alertas automáticas</h3></div><span className="status pending">3 nuevas</span></div>
                <div className="alert-row"><span>↔</span><div><strong>Patrón de valoración recíproca</strong><p>2 trabajadores se califican siempre con 5 estrellas.</p></div></div>
                <div className="alert-row"><span>↓</span><div><strong>Cambio brusco de puntuación</strong><p>Una valoración difiere 2.1 puntos del promedio.</p></div></div>
              </article>
            </section>
            <section className="panel leaderboard">
              <div className="panel-head"><div><span className="section-kicker">PROMEDIO MENSUAL</span><h3>Resumen general de trabajadores</h3></div><button className="text-button" onClick={() => setView("resultados")}>Abrir informe completo →</button></div>
              <div className="leader-row header"><span>Trabajador</span><span>Sección</span><span>Promedio</span><span>Cumplimiento</span><span>Proyección</span></div>
              {monthly.slice(0, 4).map((person) => (
                <div className="leader-row" key={person.name}><span><i className="avatar tiny">{person.initials}</i><strong>{person.name}</strong></span><span>{person.section}</span><span className="score">★ {person.total}</span><span>96%</span><span className="status complete">{person.status}</span></div>
              ))}
            </section>
          </>
        )}

        {role === "admin" && view === "resultados" && (
          <section className="admin-report">
            <div className="section-heading">
              <div><p className="eyebrow">INFORME MENSUAL · JULIO 2026</p><h2>Promedios por trabajador y criterio</h2><span>Vista administrativa completa. Las identidades de los evaluadores permanecen protegidas.</span></div>
              <div className="filters">{["Todas", "Salón", "Barra", "Cocina"].map((section) => <button className={selectedSection === section ? "active" : ""} onClick={() => setSelectedSection(section)} key={section}>{section}</button>)}</div>
            </div>
            <div className="report-table">
              <div className="report-row head"><span>Trabajador</span><span>Sección</span><span>Equipo</span><span>Actitud</span><span>Apoyo</span><span>Servicio</span><span>General</span><span>Estado</span></div>
              {filteredMonthly.map((person, index) => (
                <div className="report-row" key={person.name}>
                  <span><i>{index + 1}</i><b className="avatar tiny">{person.initials}</b><strong>{person.name}</strong></span>
                  <span>{person.section}</span><span>{person.team}</span><span>{person.attitude}</span><span>{person.support}</span><span>{person.service}</span><span className="score">★ {person.total}</span><span className={person.status === "Premiable" ? "status complete" : "status neutral"}>{person.status}</span>
                </div>
              ))}
            </div>
            <div className="admin-grid">
              <article className="panel"><div className="panel-head"><h3>Promedio por sección</h3></div>{[["Salón", "4.70", "94%"], ["Barra", "4.75", "95%"], ["Cocina", "4.73", "95%"]].map(([label, value, width]) => <div className="section-average" key={label}><span>{label}</span><div className="mini-progress"><i style={{width}} /></div><strong>{value}</strong></div>)}</article>
              <article className="panel fairness"><div className="panel-head"><h3>Reglas aplicadas al promedio</h3></div><ul><li>✓ Mínimo 10 evaluaciones válidas</li><li>✓ Sin autoevaluaciones</li><li>✓ Atípicos extremos quedan en revisión</li><li>✓ Evaluadores siempre anónimos</li></ul></article>
            </div>
          </section>
        )}

        {role === "admin" && view === "recompensas" && (
          <>
            <section className="section-heading">
              <div><p className="eyebrow">CONFIGURACIÓN DEL MES</p><h2>Reglas de recompensas</h2><span>Todos conocen de antemano cómo se obtiene cada beneficio.</span></div>
              <button className="primary">+ Nueva regla</button>
            </section>
            <section className="rules-list">
              {[
                ["Aumento porcentual de propinas", "Promedio ≥ 4.70", "+3%", "7 elegibles", "Activa"],
                ["Bono en efectivo o tarjeta", "Promedio ≥ 4.80 + cumplimiento ≥ 95%", "$25.000", "3 elegibles", "Activa"],
                ["Descanso adicional pagado", "24 días de evaluaciones completas", "60 minutos", "5 elegibles", "Activa"],
                ["Empleado del mes", "Mejor promedio elegible + validación del jefe", "Reconocimiento + bono", "3 finalistas", "Pendiente"],
              ].map(([title, condition, benefit, eligible, status]) => (
                <article key={title}><span className="rule-icon">★</span><div className="rule-copy"><h3>{title}</h3><p>{condition}</p></div><div><small>BENEFICIO</small><strong>{benefit}</strong></div><div><small>PROYECCIÓN</small><strong>{eligible}</strong></div><span className={status === "Activa" ? "status complete" : "status pending"}>{status}</span><button className="icon-button">•••</button></article>
              ))}
            </section>
            <div className="policy-note"><span>i</span><div><strong>Recomendación de equidad</strong><p>Las estrellas deben aportar al bono, pero no decidirlo solas. Confirma asistencia, cumplimiento de funciones y ausencia de sanciones antes de aprobar un pago.</p></div></div>
          </>
        )}
      </section>
    </main>
  );
}
