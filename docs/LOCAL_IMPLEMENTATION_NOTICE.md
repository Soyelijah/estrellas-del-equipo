# Aviso de actualización para implementaciones locales

Este repositorio incorpora correcciones de seguridad de rutas HTTP y actualiza
la documentación de configuración local. Todo checkout instalado debe aplicar
esta actualización antes del próximo despliegue.

## Pasos requeridos

1. Desde la copia local, obtén el commit que contiene este aviso y cambia a la
   rama o etiqueta aprobada por tu equipo.
2. Ejecuta `npm ci` si cambió `package-lock.json`; de otro modo conserva las
   dependencias bloqueadas ya instaladas.
3. Ejecuta `npm run lint` y `npm test`.
4. Revisa las migraciones pendientes en `drizzle/` y aplícalas mediante el
   procedimiento de despliegue de D1 de tu entorno antes de publicar.
5. Comprueba que las mutaciones de autenticación y administración se envíen con
   el verbo esperado: `POST`, `PATCH` o `DELETE` según la ruta. Las rutas
   protegidas ahora responden `405 Method Not Allowed` ante un verbo distinto.

## Impacto

Los clientes que usen los verbos documentados no necesitan cambios. Un cliente
local personalizado que, por error, llame por ejemplo `PATCH /api/auth/login`
o `DELETE /api/admin/evaluation-cycles` dejará de ejecutar la operación y
recibirá una respuesta `405`; debe corregirse antes de actualizar.
