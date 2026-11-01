import base64
import os

tex_path = r'C:\Users\atsan\vpn_ux\app\src\main\assets\www\img\globe-earth-tex.png'
with open(tex_path, 'rb') as f:
    b64_str = base64.b64encode(f.read()).decode('ascii')

for base_dir in [r'C:\Users\atsan\vpn_ux\app\src\main\assets\www', r'C:\Users\atsan\OneDrive\Bureau\LaboSurfVPN\app\src\main\assets\www']:
    js_path = os.path.join(base_dir, 'js', 'globe-earth-tex-data.js')
    with open(js_path, 'w', encoding='utf-8') as f:
        f.write('// Texture de sphère terrestre photoréaliste officielle en data:URI (évite le blocage CORS file:///)\n')
        f.write('window.SP_EARTH_TEX = "data:image/png;base64,' + b64_str + '";\n')
    print('Written:', js_path, 'size:', os.path.getsize(js_path))
