# Estado de implementación

Última actualización: 2026-08-24.

## Núcleo operativo implementado

- Activación única, inicio de sesión y recuperación protegida de la cuenta administradora.
- Cuentas reales de trabajadores con edición, suspensión, reactivación y restablecimiento de contraseña.
- Sesiones privadas de ocho horas guardadas como hashes; credenciales y secretos nunca se devuelven al navegador.
- Separación de permisos: administrador, trabajadores evaluadores y cajera evaluadora no evaluable.
- Auditoría persistente de las acciones administrativas.
- Factores de propina guardados como centésimas de punto y calculadora exacta en pesos chilenos.
- Seis criterios comunes del trabajo real de salón con el mismo peso total:
  1. Disciplina, puntualidad y presentación.
  2. Responsabilidad y precisión operativa.
  3. Atención y experiencia del cliente.
  4. Conocimiento de carta y recomendación.
  5. Comunicación, compañerismo y trabajo en equipo.
  6. Autocrítica, aprendizaje y mejora continua.
- Evaluaciones privadas derivadas de cuentas, ciclos, participaciones y turnos compartidos reales.
- Formularios diarios con controles visuales de cinco estrellas, etiquetas accesibles y alternativa honesta de no observado.
- Promedio mensual por persona y por criterio, calculado únicamente con observaciones reales.
- Cumplimiento diario separado del desempeño: los días incompletos quedan pendientes y no fabrican notas.
- Cierre mensual exclusivo del administrador, con motivo auditado y bloqueo de nuevas evaluaciones.
- Resultados sin modificación automática de los factores de propina; cualquier cambio requiere una acción administrativa explícita.
- Interfaz separada para administrador y trabajadores, con estados de carga, error y vacío sin personas ni resultados de ejemplo.
- Incorporación abierta: el sistema muestra la cantidad real de cuentas, pero no impone un máximo de seis trabajadores.
- Explicación operativa dentro del panel para distinguir el ciclo mensual vigente del registro diario de un turno.

## Persistencia y seguridad

- D1 es la fuente autoritativa para organizaciones, usuarios, sesiones, turnos, evaluaciones, resultados y auditoría.
- Todas las mutaciones requieren origen exacto y autorización de servidor.
- Consultas SQL parametrizadas y alcance obligatorio por organización.
- Límites de cuerpo, longitud y tipo aplicados antes de persistir datos.
- Cookies `HttpOnly`, `SameSite=Lax`, `Secure` en HTTPS y expiración limitada.
- Respuestas privadas con `cache-control: no-store` y cabeceras de seguridad en el Worker.
- La migración 0008 vincula cada turno con su mes de evaluación y ofrece rollback.

## Estado de publicación

La versión mensual está publicada en `https://equipo.zgamersa.com/`. El dominio personalizado y la URL de Sites sirven el mismo artefacto; la API real responde con D1, las mutaciones sin sesión se rechazan y la migración 0008 está aplicada.
