"""Render exact, unsent outreach payloads and their local approval desk. No network."""
import hashlib
import html
import json
import re
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parent
read = lambda name: json.loads((ROOT / name).read_text())
esc = html.escape
drafts = read('outreach-drafts.json')
prospects = read('prospects.json')['prospects']
social = read('social-drafts.json')['posts']
tracking = read('tracking-status.json') if (ROOT / 'tracking-status.json').exists() else {'summary': 'Click and open tracking setup in progress.'}
out = ROOT / 'email-previews'
out.mkdir(exist_ok=True)
brand = '<span style="font-family:Georgia,serif;font-size:28px;color:#24231e">Minimal<span style="color:#b7442b;font-style:italic">Pairs</span></span><span style="display:inline-block;font-family:Georgia,serif;font-size:13px;color:#716d63;margin-left:12px;white-space:nowrap">/ˈmɪnɪməl pɛəz/</span>'
address = drafts['emailFooter']['postalAddress']
optout = drafts['emailFooter']['unsubscribeAddress']

def tagged(url, channel):
    if not url.startswith('https://minimalpairs.co/'):
        return url
    return url + ('&' if '?' in url else '?') + urlencode({'utm_source': 'partner', 'utm_medium': channel, 'utm_campaign': 'listening-challenge'})

def email_html(body):
    paragraphs = []
    for paragraph in body.split('\n\n'):
        parts = re.split(r'(https://[^\s<>]+)', paragraph)
        content = ''.join(
            '<a style="color:#28588a;text-decoration:underline;overflow-wrap:anywhere;word-break:break-word" href="' + esc(part) + '">' + esc(part.split('?')[0].replace('https://', '')) + '</a>'
            if part.startswith('https://') else esc(part).replace('\n', '<br>') for part in parts)
        paragraphs.append('<p style="margin:0 0 20px;line-height:1.65">' + content + '</p>')
    return '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MinimalPairs email preview</title></head>
<body style="margin:0;background:#f3eee3;color:#24231e"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;background:#fbf8f1;border:1px solid #ded5c6;border-radius:12px"><tr><td style="padding:28px 24px;font-family:Arial,sans-serif;font-size:16px;overflow-wrap:anywhere"><div style="margin-bottom:30px">''' + brand + '</div>' + ''.join(paragraphs) + '''<div style="border-top:1px solid #ded5c6;padding-top:16px;margin-top:28px;font-size:12px;line-height:1.6;color:#716d63">MinimalPairs<br>''' + esc(address) + '<br><a href="mailto:' + esc(optout) + '?subject=Unsubscribe" style="color:#716d63;text-decoration:underline">Unsubscribe by email</a></div></td></tr></table></td></tr></table></body></html>'

parts = ['''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MinimalPairs growth approval desk</title><style>
*{box-sizing:border-box}body{font:16px/1.6 system-ui;background:#f3eee3;color:#24231e;margin:0}main{max-width:1000px;margin:auto;padding:36px 22px}h1,h2{font-family:Georgia,serif;font-weight:400}h1{font-size:clamp(32px,5vw,48px);line-height:1.1}a{color:#28588a}details,article{background:#fffdf7;border:1px solid #ded5c6;border-radius:12px;padding:20px;margin:15px 0}summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:15px/1.65 system-ui}small,.muted{color:#716d63}table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:12px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}.scroll{overflow:auto}.notice{padding:20px;background:#e8eee3;border-radius:10px}.metadata{overflow-wrap:anywhere}.frame{max-width:640px;margin:22px auto}.frame.mobile{max-width:375px}iframe{width:100%;height:1100px;border:0;background:#f3eee3;border-radius:12px}button{font:inherit;cursor:pointer;border:1px solid #cfc6b7;background:#fffdf7;padding:8px 14px;border-radius:5px}button[aria-pressed=true]{background:#24231e;color:white}.tabs{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.tag{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#716d63}nav{display:flex;gap:20px;flex-wrap:wrap}
</style></head><body><main>''', brand,
        '<h1>Your growth approval desk.</h1><p>The revised emails are ready to inspect. Nothing in this batch has been sent.</p><div class="notice"><strong>Personal emails, with light branding.</strong><p>Email recipients receive the HTML shown below plus a plain-text alternative. Contact forms use plain text. The logo includes your IPA, and each message explains that its challenge is a sample from the wider library.</p><p><strong>Tracking:</strong> ' + esc(tracking['summary']) + '</p><p class="muted">Opens are approximate; clicks can include security scanners. Website links carry campaign tags. Contact-form submissions have no email-open tracking.</p></div><nav><a href="#outreach">10 outreach drafts</a><a href="../email-course/index.html">Course email previews</a><a href="#social">6 social drafts</a><a href="#prospects">Prospects</a></nav><section id="outreach"><h2>Review the exact messages.</h2><p>Approve a draft by its ID, or request edits. This page cannot send emails. The compact postal address and unsubscribe footer apply to promotional emails.</p>']
manifest = []
for m in drafts['messages']:
    is_email = not m['channel'].startswith('https://')
    body = re.sub(r'https://[^\s<>]+', lambda x: tagged(x[0], 'email' if is_email else 'referral'), m['body'])
    assert '—' not in m['subject']
    assert 'If this is not relevant' not in body
    assert 'minimal-pair' in body.lower() or 'minimal pair' in body.lower()
    parts.append('<details id="' + m['id'] + '"' + (' open' if m['id'] == 'P05' else '') + '><summary>' + m['id'] + ' · ' + esc(m['recipient']) + '</summary><p class="tag">' + ('Email' if is_email else 'Contact form') + ' · Awaiting approval</p><p class="metadata"><strong>From:</strong> ' + esc(m['fromAddress']) + '<br><strong>To / channel:</strong> ' + esc(m['channel']) + '<br><strong>Subject:</strong> ' + esc(m['subject']) + '</p>')
    if is_email:
        text = body + '\n\nMinimalPairs\n' + address + '\nTo unsubscribe, reply "unsubscribe".\n'
        rendered = email_html(body)
        payload = {'from': 'Micheal at MinimalPairs <' + m['fromAddress'] + '>', 'reply_to': m['fromAddress'], 'to': [m['channel']], 'subject': m['subject'], 'text': text, 'html': rendered, 'headers': {'List-Unsubscribe': '<mailto:' + optout + '?subject=Unsubscribe>'}}
        raw = json.dumps(payload, ensure_ascii=False, indent=2) + '\n'
        (out / (m['id'] + '.payload.json')).write_text(raw)
        (out / (m['id'] + '.html')).write_text(rendered)
        (out / (m['id'] + '.txt')).write_text(text)
        manifest.append({'id': m['id'], 'channel': 'email', 'payloadSha256': hashlib.sha256(raw.encode()).hexdigest(), 'approved': False, 'sent': False})
        parts.append('<div class="tabs"><button type="button" aria-pressed="true" onclick="setWidth(this,false)">Desktop</button><button type="button" aria-pressed="false" onclick="setWidth(this,true)">Phone</button><a href="email-previews/' + m['id'] + '.html" target="_blank">Open email on its own ↗</a></div><div class="frame"><iframe title="Exact email preview for ' + esc(m['recipient']) + '" loading="lazy" sandbox="allow-popups allow-popups-to-escape-sandbox" src="email-previews/' + m['id'] + '.html"></iframe></div><details><summary>Plain-text alternative</summary><pre>' + esc(text) + '</pre></details>')
    else:
        (out / (m['id'] + '.txt')).write_text(body + '\n')
        manifest.append({'id': m['id'], 'channel': 'contact form', 'textSha256': hashlib.sha256((body + '\n').encode()).hexdigest(), 'approved': False, 'sent': False})
        parts.append('<pre>' + esc(body) + '</pre>')
    parts.append('</details>')
parts.append('</section><section id="social"><h2>Six shareable challenges.</h2><p>The links already work. Posting on your behalf requires the chosen account, community and exact post approval. Reddit communities have their own promotion rules.</p>')
for p in social:
    parts.append('<details><summary>' + p['id'] + ' · ' + esc(p['body'].splitlines()[0]) + '</summary><pre>' + esc(p['body']) + '</pre></details>')
parts.append('</section><section id="prospects"><h2>20 researched prospects.</h2><div class="scroll"><table><tr><th>Prospect</th><th>Why this audience</th><th>Status</th></tr>')
for p in prospects:
    parts.append('<tr><td>' + p['id'] + ' · <a href="' + esc(p['source']) + '">' + esc(p['name']) + '</a></td><td>' + esc(p['fit']) + '</td><td>' + esc(p['status']) + '</td></tr>')
parts.append('''</table></div></section><article><h2>Commercial terms.</h2><p>$0 upfront spend. $29 lifetime or $7/month. The proposed referral pilot is 30% of a first attributed purchase excluding tax and refunds; attribution and payout terms must be agreed before promotion. No payouts without owner approval.</p><p>The $99 five-student lifetime pack remains conditional on interest from at least two teachers. Course sending remains paused pending exact-copy approval.</p></article></main><script>function setWidth(button,mobile){const panel=button.closest('details');panel.querySelector('.frame').classList.toggle('mobile',mobile);panel.querySelectorAll('.tabs button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));}</script></body></html>''')
(ROOT / 'index.html').write_text(''.join(parts))
(out / 'manifest.json').write_text(json.dumps({'status': 'DRAFT ONLY; exact payload hashes require owner approval before sending', 'messages': manifest}, indent=2) + '\n')
print(f'Rendered {len(manifest)} unsent drafts, including {sum(m["channel"] == "email" for m in manifest)} HTML emails. No messages sent.')
