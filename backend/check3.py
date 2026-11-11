from lxml import html as lxml_html
import re

# Create a realistic long base64 data URL (simulate a ~10KB image)
long_base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5CKkJggg==" * 100

src = f"data:image/png;base64,{long_base64}"
print(f"src length: {len(src)}")

# Test the regex
_IMAGE_SRC_RE = re.compile(r"data:image/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+")
IMAGE_SRC_MAX_CHARS = 520000

print(f"Regex matches: {_IMAGE_SRC_RE.fullmatch(src) is not None}")
print(f"Length check: {len(src) <= IMAGE_SRC_MAX_CHARS}")

# Now test with the sanitization
html_with_img = f'<p>hello</p><img src="{src}" style="width: 30%;"><p>world</p>'

text = html_with_img
root = lxml_html.fragment_fromstring(text, create_parent='div')

# Apply sanitization
for _ in range(20):
    removed = False
    for node in list(root.iterdescendants()):
        tag = node.tag.lower() if isinstance(node.tag, str) else ''
        if tag in ('script', 'style'):
            node.drop_tree()
            removed = True
        elif tag == 'img':
            node_src = node.get('src') or ''
            if not (len(node_src) <= IMAGE_SRC_MAX_CHARS and _IMAGE_SRC_RE.fullmatch(node_src)):
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
print(f'\n=== Result length: {len(result)}')
print(f'Result: {repr(result[:300])}')
print(f'"world" in result: {"world" in result}')
print(f'"<img" in result: {"<img" in result}')
