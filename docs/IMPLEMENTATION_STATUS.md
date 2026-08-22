# Estado de implementación

Última verificación: 2026-08-22.

## Implementado y verificado

- Advertencia inequívoca de prototipo sin efectos laborales.
- Acciones administrativas ficticias deshabilitadas.
- Mensaje de envío corregido: no afirma persistencia inexistente.
- Regla que impide autoevaluación.
- Regla de misma organización.
- Regla de turno compartido.
- Regla de período abierto.
- Regla contra envíos duplicados.
- Validación de escala entera de 1 a 5.
- Exclusión de respuestas automáticas del puntaje de pares.
- Muestra mínima por observadores independientes y turnos.
- Mediana por evaluador y mediana entre evaluadores para evitar dominación por repetición.
- Resultado bajo produce revisión de coaching, nunca disciplina automática.
- Resultado alto produce candidatura, nunca recompensa automática.
- Alertas de integridad bloquean la clasificación hasta revisión.
- Falta de evidencia impide publicar una señal de desempeño.
- Ajustes negativos al factor de propinas requieren consentimiento de todos los participantes afectados.
- Las propinas entregadas directamente por clientes quedan fuera de todo ajuste.
- Pacto inactivo o retroactivo bloquea el ajuste.
- Reducción superior al límite pactado queda bloqueada.
- Ajuste negativo sin revisión humana o con apelación abierta queda bloqueado.
- Reparto exacto del fondo común usando los 4,65 puntos de experiencia acordados.
- Redondeo determinista que distribuye cada peso chileno sin pérdida ni sobrante.
- Validación de participantes únicos, factores positivos enteros y fondo no negativo.
- Configuración inicial de 7 participantes con 6 evaluadores y 5 sujetos evaluados.
- Exclusión explícita del jefe como evaluador y de jefe/cajera como sujetos evaluados.
- Esquema D1 de 17 tablas con usuarios, roles, acuerdos, participación por período, turnos, evaluaciones, resultados, revisiones y auditoría.
- Seis migraciones generadas y rollback completo probado.
- Interfaz alineada con los 7 participantes, 4,65 puntos de experiencia, 6 evaluadores y 5 sujetos evaluados.
- La interfaz no muestra puntajes, fechas, identidades, recompensas ni evaluaciones de ejemplo.
- Inicio operativo vacío con únicamente los 7 alias, permisos y factores confirmados por el usuario.
- Resultados y evaluaciones permanecen en estado vacío hasta que existan registros reales.
- Identidad de plataforma validada mediante identificador estable y correo; un correo aislado no autentica.
- Vinculación única entre usuario y sujeto autenticado mediante `users.auth_subject`.
- Autorización de organización, usuario activo, membresía vigente y rol resuelta en servidor.
- API `POST /api/evaluations` con origen estricto, límite de cuerpo, JSON validado y respuestas sin caché.
- El evaluador siempre se deriva de la sesión; el navegador no puede escogerlo.
- Evidencia de período, participación, turno compartido, criterio válido y duplicados consultada en D1.
- Envío y observaciones guardados atómicamente mediante `D1.batch`.
- Respuesta explícita `not_observed` almacenada sin puntaje y protegida por constraint SQL.
- Formulario con rúbrica 1–5, estado “No observado” y mínimo de dos criterios realmente observados por compañero.

## Evidencia automatizada

- `tests/fairness-core.test.mjs`: 22 pruebas del núcleo de justicia y autorización de consecuencias.
- `tests/tip-allocation.test.mjs`: 10 pruebas del reparto exacto de propinas, factores de experiencia y redondeo en pesos chilenos.
- `tests/team-config.test.mjs`: 2 pruebas del equipo y sus permisos de evaluación.
- `tests/database-migration.test.mjs`: 5 pruebas de creación, rollback, factores, identidad y respuestas sin puntaje.
- `tests/rendered-html.test.mjs`: 1 prueba de render del Worker.
- `tests/access-control.test.mjs`: 9 pruebas de identidad y membresía.
- `tests/evaluation-command.test.mjs`: 8 pruebas del comando seguro.
- `tests/evaluation-service.test.mjs`: 5 pruebas del servicio de aplicación.
- `tests/d1-evaluation-repository.test.mjs`: 3 pruebas SQL con SQLite real en memoria.
- `tests/request-security.test.mjs`: 2 pruebas de origen de mutaciones.
- `tests/evaluation-http.test.mjs`: 3 pruebas del adaptador HTTP.
- `npm test`: 70 de 70 pruebas aprobadas después de compilar y validar el artefacto Sites.
- `npm run lint`: aprobado sin errores.

## Todavía no implementado

- Flujo de inicio de sesión elegido y conectado a la página operativa.
- Aplicación de migraciones a una instancia D1 local y alojada.
- Consulta de sesión y carga de formularios reales desde la API.
- Auditoría persistente.
- Moderación de comentarios.
- Flujo de revisión y apelación.
- Catálogo y aprobación de recompensas.
- Planes de mejora.
- Validación del modelo de amenazas antes del uso real.

El endpoint seguro ya puede validar y persistir un envío cuando recibe una sesión reconocida y una base migrada. La interfaz visible ya no simula información: muestra la configuración confirmada y estados vacíos honestos. Aún deben elegirse el mecanismo de inicio de sesión, crear las siete cuentas, cargar turnos y períodos y aplicar migraciones antes de recopilar evaluaciones reales.
