from lxml import html as lxml_html
import re

# Simulate what the editor produces with an image
html_with_img = '<p>hello</p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5CKkJggg==" style="width: 30%;"><p>world</p>'

text = html_with_img
root = lxml_html.fragment_fromstring(text, create_parent='div')

print('=== Root children ===')
for child in root:
    print(f'  tag={child.tag}, text={repr(child.text)[:80] if child.text else None}')

print()
print('=== All descendants with tail ===')
for node in root.iterdescendants():
    tag = node.tag.lower() if isinstance(node.tag, str) else ''
    src = node.get('src') or ''
    style = node.get('style') or ''
    tail = repr(node.tail)[:80] if node.tail else 'None (no tail)'
    print(f'  tag={tag}, src={src[:40] if src else None}, style={style[:40] if style else None}, tail={tail}')

# Now apply sanitization
_IMAGE_SRC_RE = re.compile(r'data:image/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+')
IMAGE_SRC_MAX_CHARS = 520000

for _ in range(20):
    removed = False
    for node in list(root.iterdescendants()):
        tag = node.tag.lower() if isinstance(node.tag, str) else ''
        if tag in ('script', 'style'):
            node.drop_tree()
            removed = True
        elif tag == 'img':
            src = node.get('src') or ''
            if not (len(src) <= IMAGE_SRC_MAX_CHARS and _IMAGE_SRC_RE.fullmatch(src)):
                node.drop_tree()
                removed = True
                continue
            for name in list(node.attrib):
                if name == 'style':
                    cleaned = ';'.join(
                        chunk for chunk in (node.get('style') or '').split(';')
                        if chunk.strip().lower().split(':')[0] in 
                        {'text-align', 'font-weight', 'font-style', 'text-decoration', 'font-size', 'width'}
                    )
                    if cleaned:
                        node.set('style', cleaned)
                    else:
                        del node.attrib[name]
                elif name != 'src':
                    del node.attrib[name]
        elif tag not in {'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'br', 'div', 'p', 'span', 'ul', 'ol', 'li', 'img'}:
            node.drop_tag()
            removed = True
        else:
            for name in list(node.attrib):
                if name == 'style':
                    cleaned = ';'.join(
                        chunk for chunk in (node.get('style') or '').split(';')
                        if chunk.strip().lower().split(':')[0] in 
                        {'text-align', 'font-weight', 'font-style', 'text-decoration', 'font-size', 'width'}
                    )
                    if cleaned:
                        node.set('style', cleaned)
                    else:
                        del node.attrib[name]
                else:
                    del node.attrib[name]
    if not removed:
        break

result = (root.text or '') + ''.join(
    lxml_html.tostring(child, encoding='unicode') for child in root
)
print(f'\n=== Result: {repr(result)}')
print(f'Result length: {len(result)}')
print(f'"world" in result: {"world" in result}')
print(f'"<img" in result: {"<img" in result}')