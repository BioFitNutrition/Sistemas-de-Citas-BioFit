#!/usr/bin/env python3
"""
build.py — Genera el index.html único que se publica en GitHub Pages.

Toma el proyecto modular de /src y produce un solo archivo en la raíz con
todo embebido: CSS inline, los módulos JS combinados en un único
<script type="module">, y las imágenes como data URI.

Uso:
    python build.py

El código fuente que se edita vive SIEMPRE en /src. El index.html de la raíz
es un artefacto generado: no lo edites a mano, se sobrescribe en cada build.
"""

import base64
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).parent
SRC = RAIZ / "src"
SALIDA = RAIZ / "index.html"

# Orden de los módulos: las dependencias van primero.
MODULOS = [
    "config.js",
    "supabaseClient.js",
    "utils.js",
    "calendario.js",
    "sedes.js",
    "auth.js",
    "client.js",
    "panel.js",
    "usuarios.js",
    "notificaciones.js",
    "cancelar.js",
    "main.js",
]

# Único import externo que debe sobrevivir al combinado.
IMPORT_SUPABASE = (
    'import { createClient } from '
    '"https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";'
)


MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".webp": "image/webp", ".svg": "image/svg+xml"}


def data_uri(ruta: Path) -> str:
    """Convierte una imagen a data URI base64."""
    b64 = base64.b64encode(ruta.read_bytes()).decode()
    return f"data:{MIME[ruta.suffix.lower()]};base64,{b64}"


# Captura imports de módulos locales ("./x.js") y del CDN de Supabase, incluidos
# los que ocupan varias líneas. `[^;]*?` cruza saltos de línea pero nunca un `;`,
# que es justo donde termina un import.
RE_IMPORT = re.compile(
    r'import\s+[^;]*?\s*from\s*["\'](?:\./[^"\']+|https://cdn\.jsdelivr\.net/[^"\']+)["\']\s*;?'
)


def limpiar_modulo(codigo: str) -> str:
    """Quita imports locales y la palabra `export`, que sobran al combinar."""
    codigo = RE_IMPORT.sub("", codigo)
    # `export function x` -> `function x`   |   `export const x` -> `const x`
    codigo = re.sub(r"^(\s*)export\s+", r"\1", codigo, flags=re.MULTILINE)
    return codigo


def detectar_colisiones(modulos: dict) -> list:
    """Busca nombres declarados en más de un módulo.

    Al combinar todo en un solo <script>, los módulos dejan de tener su propio
    ámbito: dos funciones privadas con el mismo nombre en archivos distintos
    chocan y el navegador lanza 'Identifier has already been declared'.
    Mejor detectarlo aquí que descubrirlo en producción.
    """
    from collections import defaultdict

    declaraciones = defaultdict(list)
    re_func = re.compile(r"^(?:async\s+)?function\s+(\w+)", re.MULTILINE)
    re_var = re.compile(r"^(?:const|let|var)\s+(\w+)", re.MULTILINE)

    for nombre, codigo in modulos.items():
        for patron in (re_func, re_var):
            for m in patron.finditer(codigo):
                declaraciones[m.group(1)].append(nombre)

    return [
        (ident, archivos)
        for ident, archivos in sorted(declaraciones.items())
        if len(archivos) > 1
    ]


def main() -> int:
    if not SRC.exists():
        print(f"ERROR: no encuentro la carpeta {SRC}", file=sys.stderr)
        return 1

    html = (SRC / "index.html").read_text(encoding="utf-8")
    css = (SRC / "css" / "styles.css").read_text(encoding="utf-8")

    # ---- 1. Leer y limpiar los módulos JS ----
    limpios = {}
    for nombre in MODULOS:
        ruta = SRC / "js" / nombre
        if not ruta.exists():
            print(f"ERROR: falta el módulo {ruta}", file=sys.stderr)
            return 1
        limpios[nombre] = limpiar_modulo(ruta.read_text(encoding="utf-8"))

    # ---- 2. Abortar si hay nombres repetidos entre módulos ----
    colisiones = detectar_colisiones(limpios)
    if colisiones:
        print("ERROR: hay nombres declarados en más de un módulo.", file=sys.stderr)
        print("Al combinarlos en un solo ámbito, el navegador fallaría.", file=sys.stderr)
        for ident, archivos in colisiones:
            print(f"   · {ident}  ->  {', '.join(archivos)}", file=sys.stderr)
        print("Renombra uno de ellos y vuelve a correr el build.", file=sys.stderr)
        return 1

    partes = [IMPORT_SUPABASE, ""]
    for nombre in MODULOS:
        partes.append(f"// ===== {nombre} =====")
        partes.append(limpios[nombre])
        partes.append("")
    js = "\n".join(partes)

    # ---- 3. Embeber CSS ----
    html = html.replace(
        '<link rel="stylesheet" href="css/styles.css" />',
        f"<style>\n{css}\n</style>",
    )

    # ---- 4. Embeber imágenes ----
    for archivo in ("favicon.png", "logo.png", "logo-full.png", "portada-biofit.jpg"):
        ruta = SRC / "assets" / archivo
        if not ruta.exists():
            print(f"ERROR: falta el asset {ruta}", file=sys.stderr)
            return 1
        html = html.replace(f"assets/{archivo}", data_uri(ruta))

    # ---- 5. Embeber JS ----
    html = html.replace(
        '<script type="module" src="js/main.js"></script>',
        f'<script type="module">\n{js}\n</script>',
    )

    # ---- 6. Verificar que no quedaron referencias externas ----
    for resto in ('href="css/', 'src="js/', 'src="assets/', 'href="assets/'):
        if resto in html:
            print(f"ERROR: quedó una referencia sin embeber: {resto}", file=sys.stderr)
            return 1

    SALIDA.write_text(html, encoding="utf-8")
    kb = len(html.encode("utf-8")) / 1024
    print(f"OK  ->  {SALIDA.name} generado ({kb:.0f} KB)")
    print("Ahora: git add -A && git commit -m 'build' && git push")
    return 0


if __name__ == "__main__":
    sys.exit(main())
