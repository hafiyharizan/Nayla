#!/usr/bin/env python3
"""
Turn a WhatsApp "Nayla daily log" export into a Nayla backup file.

The chat is two people jotting entries in shorthand, in a mix of English,
Malay and emoji, over three weeks. It is not structured data, so this is a
best-effort reader: it recognises the vocabulary actually used in the log,
reports anything it could not read, and never invents a value it did not see.

    python3 tools/import-whatsapp.py _chat.txt -o nayla-import.json

Then load the result with Settings -> Data -> Import in the app.
"""

import argparse, json, re, sys
from datetime import datetime, timedelta, timezone

# The export's timestamps are the phone's local time. Corroborated inside the
# chat itself: a message at 4:09 pm notes Medan (UTC+7) was "3.09pm, one hour
# late", which puts the log at UTC+8.
TZ = timezone(timedelta(hours=8))

MSG = re.compile(r'^\[(\d{1,2})/(\d{1,2})/(\d{4}),\s*(\d{1,2}):(\d{2}):(\d{2})\s*([ap])m\]\s*([^:]+):\s?(.*)$')

# Lines WhatsApp itself generates, plus non-entry chatter we should not guess at.
NOISE = re.compile(
    r'(end-to-end encrypted|created group|added you|changed this group|'
    r'sticker omitted|image omitted|video omitted|audio omitted|document omitted|'
    r'message was deleted|missed video call|missed voice call|deleted this message)',
    re.I)

EDITED = re.compile(r'\s*<This message was edited>\s*$')

# ── the log's vocabulary ────────────────────────────────────────────────
FEED    = re.compile(r'🍼|\bfeed\b|\bmilk\b|\bneneng\b', re.I)
SLEEP   = re.compile(r'💤|\bsleep\b', re.I)
WAKE    = re.compile(r'🌅|\bbangun\b|\bwake\s*up\b|\bwoke\s*up\b', re.I)
DIRTY   = re.compile(r'💩|\bberak\b', re.I)
WET     = re.compile(r'💧|\bpee\b', re.I)
NAPPY   = re.compile(r'\bnapp(y|ies)\b|\bdiaper\b', re.I)

AMOUNT  = re.compile(r'(\d{1,3})\s*(?:ml|mls|kl)\b', re.I)   # "50kl" is a typo for ml
ADDS_ON = re.compile(r'^\s*[+^]')                            # "+ 80 mls", "^100ml"

# Times: "7.30 pm", "4:40am", "2pm", "12 am", and bare "1130" / "345 pm" / "8.30".
T_MERIDIEM = re.compile(r'\b(\d{1,2})[.:](\d{2})\s*([ap])\.?m\b', re.I)
T_HOUR_MER = re.compile(r'\b(\d{1,2})\s*([ap])\.?m\b', re.I)
T_BARE_HM  = re.compile(r'(?:^|[^\d:.])(\d{1,2})[.:](\d{2})(?!\s*(?:ml|mls|kl))', re.I)
T_COMPACT  = re.compile(r'(?:^|\s)(\d{3,4})(?!\s*(?:ml|mls|kl))\b', re.I)

# "Continue neneng🍼 so / 130ml" means the feed before it carried on, not a
# second feed.
CONTINUES = re.compile(r'\bcontinue\b|\bsambung\b', re.I)

# Emoji shorthand is unambiguous; prose is not. A line with no time and no
# emoji is only read as an entry if it is terse ("Berak", "Change nappy") —
# otherwise it is someone talking about the baby, not logging her.
EMOJI_MARK = re.compile(r'🍼|💤|🌅|💩|💧')

# Annotations worth keeping on the record rather than discarding.
NOTEWORTHY = re.compile(
    r'record brok|vomit|saline|refuse|jeluak|shower|mandi|🛀|'
    r'burp|mucus|panadol|medicine|ubat', re.I)


def parse_messages(text):
    """WhatsApp wraps long messages; a line without a header continues the last."""
    out = []
    for raw in text.splitlines():
        line = raw.replace('‎', '').replace(' ', ' ').rstrip()
        m = MSG.match(line)
        if m:
            d, mo, y, hh, mm, ss, mer, sender, body = m.groups()
            hh = int(hh) % 12 + (12 if mer.lower() == 'p' else 0)
            out.append({
                'ts': datetime(int(y), int(mo), int(d), hh, int(mm), int(ss), tzinfo=TZ),
                'sender': sender.strip(),
                'lines': [body],
            })
        elif out:
            out[-1]['lines'].append(line)
    for msg in out:
        msg['lines'] = [EDITED.sub('', l).strip() for l in msg['lines']]
    return out


def find_time(line, sent_at):
    """Read the time an entry refers to, resolving it against when it was sent.

    Entries are written after the fact ("7.30 pm - nappy change" at 10:51 pm),
    so an unqualified time means the most recent occurrence at or before the
    message. That also settles bare times like "1130" and "8.30".
    """
    def resolve(hour, minute, meridiem):
        if meridiem:
            hour = hour % 12 + (12 if meridiem.lower() == 'p' else 0)
            cands = [hour]
        else:
            # Try both readings of an ambiguous hour, prefer the one that sits
            # at or just before the message.
            cands = [hour % 12, hour % 12 + 12]
            if hour >= 13:
                cands = [hour]
        best = None
        for h in cands:
            if not (0 <= h <= 23 and 0 <= minute <= 59):
                continue
            t = sent_at.replace(hour=h, minute=minute, second=0, microsecond=0)
            # Written up to ~14h late; if it lands ahead of the message it
            # belongs to the day before (an entry logged just after midnight).
            if t > sent_at + timedelta(minutes=20):
                t -= timedelta(days=1)
            lag = (sent_at - t).total_seconds()
            if best is None or lag < best[0]:
                best = (lag, t)
        return best[1] if best else None

    m = T_MERIDIEM.search(line)
    if m:
        return resolve(int(m.group(1)), int(m.group(2)), m.group(3)), m.end()
    m = T_HOUR_MER.search(line)
    if m:
        return resolve(int(m.group(1)), 0, m.group(2)), m.end()
    m = T_COMPACT.search(line)
    if m:
        v = m.group(1)
        hh, mm = (int(v[:-2]), int(v[-2:]))
        t = resolve(hh, mm, None)
        if t:
            return t, m.end()
    m = T_BARE_HM.search(line)
    if m:
        return resolve(int(m.group(1)), int(m.group(2)), None), m.end()
    return None, 0


def is_prose(line):
    """Chatter that happens to mention a keyword, rather than a log entry."""
    return len(line.split()) > 3 and not EMOJI_MARK.search(line)


def classify(line):
    """What kind of entry is this line, if any?"""
    if WAKE.search(line):
        return 'wake'
    if SLEEP.search(line):
        return 'sleep'
    if DIRTY.search(line) or WET.search(line) or NAPPY.search(line):
        return 'diaper'
    if FEED.search(line) or AMOUNT.search(line):
        return 'feed'
    return None


def diaper_kind(line):
    wet, dirty = bool(WET.search(line)), bool(DIRTY.search(line))
    if wet and dirty:
        return 'both', None
    if dirty:
        return 'dirty', None
    if wet:
        return 'wet', None
    # "nappy change" with no detail — recorded, but say so rather than guess.
    return 'wet', 'type not recorded'


def note_for(line):
    return line.strip() if NOTEWORTHY.search(line) else ''


def build(messages, report):
    events = []          # chronological: feeds, diapers, sleeps, wakes
    last_feed = None     # most recent feed, for amounts that arrive separately

    for msg in messages:
        prev_at = None       # time of the last entry in THIS message
        for line in msg['lines']:
            if not line or NOISE.search(line):
                continue

            at, _ = find_time(line, msg['ts'])
            kind = classify(line)
            amt = AMOUNT.search(line)

            # A feed that carried on: top up the previous one.
            if kind == 'feed' and at is None and CONTINUES.search(line):
                report['continuations'] += 1
                continue

            # No time and not terse enough to be shorthand -> conversation.
            if at is None and kind is not None and is_prose(line):
                report['skipped'].append((str(msg['ts']), line))
                continue

            # A line that is only an amount belongs to the feed before it:
            # "7:50pm 🍼" ... "70ml", or an explicit "^100ml" / "+ 80 mls".
            if amt and at is None and kind == 'feed':
                if last_feed is None:
                    report['orphan_amounts'].append((str(msg['ts']), line))
                    continue
                value = int(amt.group(1))
                if ADDS_ON.match(line) and last_feed['amount']:
                    last_feed['amount'] += value        # a top-up of the same feed
                else:
                    last_feed['amount'] = value
                continue

            if kind is None:
                if line.strip():
                    report['skipped'].append((str(msg['ts']), line))
                continue

            if at is None:
                # "6:30am 🍼 / 115ml / Berak" — the trailing line belongs to the
                # same moment as the entry above it, not to when it was sent.
                at = prev_at or msg['ts'].replace(second=0, microsecond=0)
                report['timeless'].append((str(msg['ts']), line, str(at)))
            prev_at = at

            ev = {'at': at, 'type': kind, 'note': note_for(line), 'raw': line}
            if kind == 'feed':
                ev['amount'] = int(amt.group(1)) if amt else None
                last_feed = ev
            elif kind == 'diaper':
                ev['kind'], why = diaper_kind(line)
                if why:
                    report['diaper_unspecified'] += 1
            events.append(ev)

    events.sort(key=lambda e: e['at'])
    return events


def to_records(events, report):
    """Pair 💤 with the wake that follows it, and emit the app's record shape."""
    records = []
    seq = 0

    def add(rec):
        nonlocal seq
        seq += 1
        stamp = int(rec['at'].timestamp() * 1000)
        records.append({
            'id': f'wa{seq:04d}',
            'type': rec['type'],
            'at': stamp,
            'end': rec.get('end'),
            'note': rec.get('note', ''),
            'data': rec.get('data', {}),
            'updatedAt': stamp,
            'rev': 0,
            'dirty': True,
            'deleted': False,
        })

    for i, ev in enumerate(events):
        if ev['type'] == 'feed':
            add({'at': ev['at'], 'type': 'feed', 'note': ev['note'],
                 'data': {'method': 'bottle', 'amount': ev['amount']}})
            if ev['amount'] is None:
                report['feeds_without_amount'] += 1

        elif ev['type'] == 'diaper':
            add({'at': ev['at'], 'type': 'diaper', 'note': ev['note'],
                 'data': {'kind': ev['kind']}})

        elif ev['type'] == 'sleep':
            end, why = None, None
            for nxt in events[i + 1:]:
                gap = (nxt['at'] - ev['at']).total_seconds()
                if gap > 12 * 3600:
                    break
                if gap <= 0:
                    continue
                if nxt['type'] == 'wake':
                    end, why = nxt['at'], 'logged'
                    break
                if nxt['type'] in ('feed', 'diaper'):
                    # No wake-up was written down, but she was plainly awake
                    # by the next entry. Close it there and say so.
                    end, why = nxt['at'], 'inferred'
                    break
                if nxt['type'] == 'sleep':
                    # Settled again without a wake being written down. She was
                    # awake somewhere in between, so this end is an upper bound.
                    end, why = nxt['at'], 'inferred'
                    break
            if end is None:
                if i == len(events) - 1:
                    report['sleep_left_open'] += 1
                else:
                    report['sleep_dropped'] += 1
                    continue
            note = ev['note']
            if why == 'inferred':
                note = (note + ' · ' if note else '') + 'wake-up not logged; ended at next entry'
                report['sleep_inferred_end'] += 1
            else:
                report['sleep_paired'] += 1
            add({'at': ev['at'], 'type': 'sleep', 'note': note,
                 'end': int(end.timestamp() * 1000) if end else None})

        elif ev['type'] == 'wake':
            prior = any(e['type'] == 'sleep' and 0 < (ev['at'] - e['at']).total_seconds() <= 12 * 3600
                        for e in events[:i])
            if not prior:
                report['orphan_wakes'] += 1

    return records


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('chat')
    ap.add_argument('-o', '--out', default='nayla-import.json')
    args = ap.parse_args()

    report = {'skipped': [], 'timeless': [], 'orphan_amounts': [],
              'diaper_unspecified': 0, 'feeds_without_amount': 0,
              'sleep_paired': 0, 'sleep_inferred_end': 0,
              'sleep_dropped': 0, 'sleep_left_open': 0, 'orphan_wakes': 0,
              'continuations': 0}

    text = open(args.chat, encoding='utf-8').read()
    messages = parse_messages(text)
    events = build(messages, report)
    records = to_records(events, report)

    payload = {
        'version': 2,
        'exportedAt': datetime.now(TZ).isoformat(),
        'source': 'WhatsApp "Nayla daily log" export',
        'records': records,
    }
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2)

    counts = {}
    for r in records:
        counts[r['type']] = counts.get(r['type'], 0) + 1
    span = (min(r['at'] for r in records), max(r['at'] for r in records)) if records else (0, 0)

    print(f"messages read : {len(messages)}")
    print(f"records built : {len(records)}  {counts}")
    if records:
        print("covering      : "
              f"{datetime.fromtimestamp(span[0]/1000, TZ):%d %b %Y} to "
              f"{datetime.fromtimestamp(span[1]/1000, TZ):%d %b %Y}")
    print(f"\nfeeds with no amount recorded : {report['feeds_without_amount']}")
    print(f"diapers with no type recorded : {report['diaper_unspecified']}")
    print(f"sleeps closed by a logged wake: {report['sleep_paired']}")
    print(f"sleeps closed at next entry   : {report['sleep_inferred_end']}")
    print(f"sleeps dropped (no end found) : {report['sleep_dropped']}")
    print(f"sleeps left open (last record): {report['sleep_left_open']}")
    print(f"wake-ups with no sleep before : {report['orphan_wakes']}")
    print(f"amounts with no feed to attach: {len(report['orphan_amounts'])}")
    print(f"feeds continued (merged, not new): {report['continuations']}")

    if report['skipped']:
        print(f"\n--- {len(report['skipped'])} lines read as conversation, not entries ---")
        for ts, line in report['skipped']:
            print(f"  {ts[:16]}  {line[:88]}")
    if report['timeless']:
        print(f"\n--- {len(report['timeless'])} entries with no time; used the message's own timestamp ---")
        for ts, line, used in report['timeless']:
            print(f"  {ts[:16]}  {line[:60]:<60} -> {used[:16]}")
    if report['orphan_amounts']:
        print(f"\n--- amounts that had no feed to attach to ---")
        for ts, line in report['orphan_amounts']:
            print(f"  {ts[:16]}  {line[:88]}")

    print(f"\nwrote {args.out}")


if __name__ == '__main__':
    main()
