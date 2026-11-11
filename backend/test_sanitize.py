from lxml import html as lxml_html
import re

html = '<p>hello</p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5CKkJggg==" style="width: 30%;"><p>world</p>'

text = html
root = lxml_html.fragment_fromstring(text, create_parent='div')

BODY_HTML_TAGS = frozenset({'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'br', 'div', 'p', 'span', 'ul', 'ol', 'li', 'img'})

_STYLE_PATTERNS = {
    'text-align': re.compile(r'(left|center|right|justify)'),
    'font-weight': re.compile(r'(normal|bold|[1-9]00)'),
    'font-style': re.compile(r'(normal|italic)'),
    'text-decoration': re.compile(r'(none|underline|line-through|underline line-through)'),
    'font-size': re.compile(r'\d{1,2}(\.\d+)?pt'),
    'width': re.compile(r'\d{1,3}%'),
}

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
                    raw = node.get('style') or ''
                    kept = []
                    for chunk in raw.split(';'):
                        prop, _, value = chunk.partition(':')
                        prop = prop.strip().lower()
                        value = ' '.join(value.split()).lower()
                        pattern = _STYLE_PATTERNS.get(prop)
                        if pattern and pattern.fullmatch(value):
                            kept.append(f'{prop}:{value}')
                    cleaned = ';'.join(kept)
                    if cleaned:
                        node.set('style', cleaned)
                    else:
                        del node.attrib[name]
                elif name != 'src':
                    del node.attrib[name]
        elif tag not in BODY_HTML_TAGS:
            node.drop_tag()
            removed = True
        else:
            for name in list(node.attrib):
                if name == 'style':
                    raw = node.get('style') or ''
                    kept = []
                    for chunk in raw.split(';'):
                        prop, _, value = chunk.partition(':')
                        prop = prop.strip().lower()
                        value = ' '.join(value.split()).lower()
                        pattern = _STYLE_PATTERNS.get(prop)
                        if pattern and pattern.fullmatch(value):
                            kept.append(f'{prop}:{value}')
                    cleaned = ';'.join(kept)
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
print('Result:', repr(result))
print('"world" in result:', 'world' in result)
print('<img> in result:', '<img' in result)