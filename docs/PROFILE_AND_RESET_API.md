# Perfiles y reinicio seguro

## Perfiles

- `PATCH /api/admin/users/:userId/profile`: el administrador modifica los datos profesionales de una cuenta.
- `POST /api/admin/users/:userId/avatar`: el administrador guarda o reemplaza la foto de perfil.
- `DELETE /api/admin/users/:userId/avatar`: el administrador elimina la foto.
- `PATCH /api/account/profile`: cada trabajador modifica sus propios datos personales permitidos.
- `POST /api/account/avatar` y `DELETE /api/account/avatar`: cada trabajador administra su foto.
- `GET /api/users/:userId/avatar`: entrega la imagen, sin exponerla en `/api/auth/status`.

Los campos admitidos son correo, teléfono, biografía breve y fecha de ingreso. Las fotos se aceptan únicamente como JPEG, PNG o WebP, con un máximo de 160 KiB después de la compresión del navegador. Todos los cambios quedan registrados en auditoría.

## Reinicio total

- `POST /api/admin/system/reset`

Requisitos simultáneos:

1. sesión administradora activa;
2. contraseña actual del administrador;
3. clave única de acceso inicial;
4. frase exacta `ELIMINAR TODO Y REINICIAR`.

La operación elimina de forma transaccional organizaciones, cuentas, sesiones, turnos, evaluaciones, acuerdos y auditoría, incluida la cuenta administradora. Al terminar borra la cookie de sesión y vuelve a habilitar el formulario de creación inicial. No debe ejecutarse en producción sin una confirmación explícita e independiente del propietario.
