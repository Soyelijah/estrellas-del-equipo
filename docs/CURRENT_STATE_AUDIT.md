# Auditoría del estado actual

Fecha de verificación: 2026-08-25
Fuente revisada: GitHub `main`, commit `3ef7b7b727cb8ff36de24134ba7862279e22eec4`

## Veredicto

El proyecto ya no es un prototipo estático. La fuente actual implementa cuentas reales, sesiones protegidas, persistencia D1, perfiles privados, ciclos, turnos, evaluaciones por estrellas, resultados mensuales y controles administrativos auditados. La publicación vigente debe actualizarse con una nueva versión de Sites antes de considerar que producción contiene exactamente este commit.

## Evidencia del estado

| Área | Estado confirmado | Evidencia actual | Verificación pendiente |
|---|---|---|---|
| Datos | La interfaz deriva cuentas, turnos, evaluaciones y resultados desde la API; no inventa personas ni puntajes | `app/page.tsx`, `tests/evaluation-ui-contract.test.mjs` | Prueba visual posterior al próximo despliegue |
| Persistencia | D1 almacena organizaciones, usuarios, sesiones, perfiles, turnos, evaluaciones, acuerdos y auditoría | `db/schema.ts`, `drizzle/`, `server/d1-admin-auth-repository.ts`, `server/d1-evaluation-repository.ts` | Confirmar respaldo y consultas en la base de producción después del despliegue |
| Identidad | Activación única del administrador, acceso por usuario y contraseña, recuperación protegida y sesiones con hash | `server/admin-auth-service.ts`, `server/admin-auth-http.ts` | Prueba real con cada tipo de cuenta en producción |
| Autorización | Las rutas administrativas y personales derivan al actor desde la sesión y validan rol, organización, origen y método HTTP | `server/admin-auth-http.ts`, `server/evaluation-http.ts` | Mantener pruebas de regresión al agregar rutas |
| Privacidad | Un trabajador ve sus propios datos privados, pero no correo, teléfono, biografía, fecha de ingreso ni usuario de otros compañeros; el administrador conserva la vista necesaria | `server/admin-auth-http.ts`, `tests/admin-auth-http.test.mjs` | Ninguna brecha conocida en el DTO de estado |
| Evaluación | Los formularios diarios de cinco estrellas dependen de un ciclo abierto y un turno compartido real | `domain/evaluations.ts`, `server/evaluation-http.ts`, `app/page.tsx` | Prueba de punta a punta con turnos reales después del despliegue |
| Resultados | El promedio mensual distingue observaciones reales, ausencias y estimaciones; no cambia automáticamente factores de propina | `domain/monthly-results.ts`, `domain/fairness.ts` | Revisión humana del primer cierre mensual |
| Administración | Permite editar, suspender y eliminar cuentas, moderar historial y limpiar datos operativos conservando usuarios | `server/admin-auth-service.ts`, `server/d1-admin-auth-repository.ts` | Ejecutar acciones destructivas solo con confirmación explícita y respaldo |
| Pruebas | La compilación de Sites y 170 pruebas cubren autenticación, autorización, D1, perfiles, evaluaciones, justicia, propinas y contratos de interfaz | `npm test`, 2026-08-25 | Añadir pruebas E2E contra la versión publicada |

## Fortalezas que deben preservarse

- Separación clara entre administración y trabajadores.
- Evaluaciones privadas basadas en conductas observadas y seis criterios comunes.
- Jefe de garzones y cajera no evaluables según el acuerdo; la cajera sí puede evaluar.
- Ninguna sanción, premio o cambio de propina se aplica automáticamente.
- Historial administrativo auditable y acciones destructivas protegidas.
- Controles de estrellas accesibles y respeto por `prefers-reduced-motion`.
- Diseño responsive sin exigir un máximo artificial de seis cuentas.

## Riesgos y trabajo pendiente

1. Publicar el commit aprobado como una nueva versión de Sites y comprobar que el artefacto servido coincide con la fuente.
2. Ejecutar una prueba E2E real con administrador, jefe de garzones, garzón y cajera: acceso, perfil, turno, evaluación, cierre y auditoría.
3. Verificar respaldo, latencia y disponibilidad de D1 en producción antes de usar acciones de limpieza.
4. Resolver las advertencias de compatibilidad futura de Vite sobre importaciones JSON y extensiones explícitas.
5. Mantener revisión humana, motivo registrado y posibilidad de corrección antes de cualquier decisión sobre factores de propina.

## Condición de uso operativo

La fuente está preparada para evaluación operativa controlada. La aptitud de la versión pública depende de completar el despliegue y la prueba E2E señalados arriba. Los resultados deben apoyar conversación, aprendizaje y decisión humana; nunca producir sanciones o modificaciones automáticas de propinas.
