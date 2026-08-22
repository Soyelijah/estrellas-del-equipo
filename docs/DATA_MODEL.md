# Modelo de datos propuesto

Estado: esquema inicial de 17 tablas y seis migraciones generadas con rollback probado en SQLite en memoria. El binding D1 está declarado, pero las migraciones no se han aplicado a una instancia local o alojada y no se almacenan datos reales.

## Límites del modelo

El modelo separa cuatro dominios que no deben mezclarse:

1. Identidad y organización.
2. Observaciones y resultados agregados.
3. Reconocimientos y recompensas.
4. Mejora y disciplina formal.

Una evaluación de pares nunca crea directamente una recompensa, una multa, una amonestación ni otra consecuencia laboral.

## Entidades P0

### `organizations`

- `id`, `name`, `timezone`, `status`.
- Permite aislar completamente los datos de cada empresa.

### `users`

- `id`, `login_identifier`, `auth_subject`, `display_name`, `status`.
- `auth_subject` es único, opcional durante la invitación y proviene del proveedor de identidad; el alias o correo visible no sustituye ese identificador estable.
- La aplicación nunca confía en un rol enviado por el navegador.

### `memberships`

- `id`, `organization_id`, `user_id`, `role`, `job_title`, `starts_at`, `ends_at`.
- Roles iniciales: `worker`, `team_lead`, `admin`, `independent_reviewer`.
- Restricción única para una membresía activa por persona y organización.

### `evaluation_participations`

- `memberships` modela organización, cargo, nivel de acceso y vigencia.
- `evaluation_participations` congela por período si la persona puede evaluar y/o ser evaluada; así el jefe queda fuera y la cajera participa solo como evaluadora.

### `shifts` y `shift_assignments`

- Registran inicio, fin, sección y participantes reales.
- Son la evidencia que permite evaluar a un compañero.
- Índices por organización-fecha y trabajador-fecha.

### `evaluation_periods`

- `id`, `organization_id`, `starts_at`, `ends_at`, `status`, `policy_version_id`.
- Estados: `draft`, `open`, `closed`, `under_review`, `published`.
- Una política queda congelada al abrir el período.

### `policy_versions` y `criteria`

- Guardan criterios, descripciones conductuales, pesos, muestra mínima, turnos mínimos y umbrales.
- Son inmutables después de usarse.
- Un cambio crea una nueva versión futura; nunca reescribe resultados pasados.

### `evaluation_submissions`

- `id`, `organization_id`, `period_id`, `shift_id`, `rater_membership_id`, `subject_membership_id`, `submitted_at`.
- Restricciones: evaluador distinto del evaluado y unicidad por período-turno-evaluador-evaluado.
- La API también confirma organización, turno compartido, período abierto y membresías activas.

### `rating_observations`

- `id`, `submission_id`, `criterion_id`, `response_status`, `value`, `created_at`.
- Una respuesta `rated` exige un valor entero de 1 a 5; `not_observed` exige valor nulo.
- Un criterio aparece una sola vez por envío.
- Se responden todos los criterios aplicables y al menos dos deben haber sido observados; una ausencia nunca fabrica una nota.

### `result_snapshots`

- Resultado reproducible por persona, criterio, período y versión de algoritmo.
- Guarda mediana, observadores independientes, turnos observados, cobertura, confianza y fecha de cálculo.
- No guarda la identidad de evaluadores en la vista destinada al trabajador.

### `integrity_alerts`

- Señales de duplicado, reciprocidad extrema, cambio brusco, baja cobertura o acceso irregular.
- Una alerta no declara culpabilidad; tiene estado, evidencia mínima, revisor y resolución.

### `audit_events`

- Registro append-only de actor, acción, objeto, organización, fecha, motivo y metadatos no sensibles.
- Se usa para cambios de reglas, accesos, exportaciones, ajustes, publicaciones, recompensas y casos de mejora.
- Nunca incluye comentarios completos ni secretos.

### `tip_agreements` y `tip_agreement_participants`

- Versionan el acuerdo, su vigencia y la aceptación de cada participante afectado.
- Guardan `factor_hundredths` como centésimas enteras positivas para evitar errores decimales (`100 = 1,00`, `75 = 0,75`). Los 4,65 puntos de experiencia se normalizan al repartir el fondo; el porcentaje de experiencia no se confunde con la participación final.
- Los cambios solo pueden regir hacia el futuro.

## Entidades P1

### `reward_rules` y `reward_decisions`

- Regla versionada con categoría, umbral, período, presupuesto, cupo y desempate.
- La decisión referencia el resultado, evidencia adicional, proponente, aprobador y motivo.
- Una candidatura nunca equivale a aprobación.

### `improvement_plans` y `improvement_checkpoints`

- Objetivo conductual, evidencia, apoyo ofrecido, responsable, plazo, respuesta del trabajador y revisiones.
- Acceso restringido a la persona, líder autorizado y revisor.

### `review_requests`

- Permite solicitar revisión de un resultado, recompensa o plan.
- Registra decisión, fundamentos y revisor distinto cuando corresponda.

### `disciplinary_cases`

- Dominio separado de la evaluación.
- Solo referencia una obligación formal, hechos, descargos, procedimiento y decisión humana.
- Un puntaje puede ser un antecedente contextual, pero no la causa automática del caso.

## Restricciones esenciales

- Todas las tablas de negocio incluyen `organization_id` o lo derivan por una FK no ambigua.
- Todas las consultas autorizadas filtran por organización en el servidor.
- FKs usan políticas de eliminación explícitas; evidencia laboral y auditoría se preservan según retención.
- Índices cubren FKs, búsquedas por período, persona, turno, estado y fecha.
- Puntajes usan enteros; dinero se expresa en unidades mínimas, nunca `float`.
- Fechas se guardan en UTC y se presentan con la zona de la organización.
- Cambios relevantes usan transacciones.
- La eliminación de una cuenta desactiva acceso; no borra silenciosamente decisiones históricas.

## Privacidad y retención inicial

- Identidad del evaluador: visible solo para controles de integridad estrictamente autorizados.
- Resultado agregado: visible al trabajador una vez cumplida la muestra mínima.
- Comentarios: acceso limitado y retención menor que los resultados agregados.
- Exportaciones: justificadas, auditadas y con expiración.
- La política definitiva de retención se valida antes del piloto.

## Orden seguro de migración

1. Aplicar `0000_tidy_lilith.sql`: organizaciones, usuarios, membresías, acuerdos, políticas, turnos, evaluaciones, resultados, revisiones y auditoría.
2. Aplicar `0001_clever_thor_girl.sql`: participación diferenciada por período.
3. Aplicar `0002_lively_ego.sql`: convertir el campo histórico de porcentaje a `weight_points`.
4. Aplicar `0003_nervous_mach_iv.sql`: agregar el vínculo único `users.auth_subject`.
5. Aplicar `0004_glossy_thunderball.sql`: renombrar sin pérdida `weight_points` a `factor_hundredths`.
6. Aplicar `0005_warm_nemesis.sql`: conservar las notas existentes como `rated` y permitir `not_observed` con valor nulo.
7. Verificar tablas, FKs, índices y rollback en una instancia D1 local antes de considerar una instancia alojada.

Cada migración incluye rollback, constraints e índices. Aún falta la verificación contra D1 local y la política operativa definitiva antes de guardar datos de personas.
