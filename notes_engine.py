"""
Local study-notes generator — no API keys required.

Uses extractive summarization, keyword scoring, and pattern matching
to build structured study materials from raw text.
"""

from __future__ import annotations

import asyncio
import re
from collections import Counter
from typing import AsyncGenerator, Iterable

# Common English stop words for keyword extraction
STOP_WORDS = frozenset(
    """
    a an the and or but if then else when at by for with about against between
    into through during before after above below to from up down in out on off
    over under again further once here there all any both each few more most
    other some such no nor not only own same so than too very can will just
    don should now is are was were be been being have has had do does did
    of that this these those it its as i me my we our you your he she they
    them his her what which who whom how why where
    """.split()
)


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip())


def _split_paragraphs(text: str) -> list[str]:
    parts = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if parts:
        return parts
    return [ln.strip() for ln in text.splitlines() if ln.strip()]


def _split_sentences(text: str) -> list[str]:
    chunks = re.split(r"(?<=[.!?])\s+", text)
    return [c.strip() for c in chunks if len(c.strip()) > 20]


def _tokenize_words(text: str) -> list[str]:
    words = re.findall(r"[a-zA-Z]{3,}", text.lower())
    return [w for w in words if w not in STOP_WORDS]


def _top_keywords(text: str, n: int = 12) -> list[str]:
    counts = Counter(_tokenize_words(text))
    return [w for w, _ in counts.most_common(n)]


def _score_sentences(sentences: list[str], keywords: list[str]) -> list[tuple[float, str]]:
    kw = set(keywords)
    scored: list[tuple[float, str]] = []
    for s in sentences:
        tokens = set(_tokenize_words(s))
        overlap = len(tokens & kw)
        length_bonus = min(len(s) / 120, 1.0)
        scored.append((overlap + length_bonus * 0.5, s))
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored


def _extract_definitions(text: str) -> list[tuple[str, str]]:
    definitions: list[tuple[str, str]] = []
    patterns = [
        r"^\s*([A-Z][A-Za-z0-9\- ]{1,40})\s*[:\-–—]\s*(.+)$",
        r"^\s*\*\*([^*]+)\*\*\s*[:\-–—]?\s*(.+)$",
        r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+is\s+(?:the\s+|a\s+|an\s+)?(.{10,120}?)[.!?]",
    ]
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        for pat in patterns:
            m = re.match(pat, line) if pat.startswith("^") else re.search(pat, line)
            if m:
                term, definition = m.group(1).strip(), m.group(2).strip()
                if 2 < len(term) < 50 and len(definition) > 8:
                    definitions.append((term, definition.rstrip(".")))
                break
    # Dedupe by term
    seen: set[str] = set()
    unique: list[tuple[str, str]] = []
    for term, defn in definitions:
        key = term.lower()
        if key not in seen:
            seen.add(key)
            unique.append((term, defn))
    return unique[:8]


def _make_quiz(sentences: list[str], keywords: list[str]) -> list[tuple[str, str]]:
    quiz: list[tuple[str, str]] = []
    for s in sentences[:12]:
        if len(quiz) >= 5:
            break
        for kw in keywords:
            if kw in s.lower() and len(s) > 40:
                masked = re.sub(re.escape(kw), "______", s, count=1, flags=re.I)
                if "______" in masked:
                    quiz.append(
                        (
                            f"What term completes this idea: \"{masked}\"?",
                            kw.title() if kw.islower() else kw,
                        )
                    )
                    break
    # Fill remaining with comprehension questions
    idx = 0
    while len(quiz) < 5 and idx < len(sentences):
        s = sentences[idx]
        idx += 1
        if len(s) < 50:
            continue
        quiz.append(
            (
                f"Explain in your own words: \"{s[:100]}{'…' if len(s) > 100 else ''}\"",
                s,
            )
        )
    return quiz[:5]


def _study_plan(keywords: list[str]) -> list[str]:
    plan = [
        "Day 1 (20 min): Read the summary and highlight unfamiliar terms.",
        "Day 2 (25 min): Review bullet points and cover definitions from memory.",
        "Day 3 (30 min): Answer all quiz questions without looking at notes.",
    ]
    if keywords:
        focus = ", ".join(keywords[:5])
        plan.append(f"Day 4 (20 min): Deep dive on core topics: {focus}.")
    plan.append("Day 5 (15 min): Re-read key takeaways and teach the topic aloud.")
    return plan


def _memory_tips(keywords: list[str]) -> list[str]:
    tips = [
        "Use the Feynman technique: explain each concept as if teaching a friend.",
        "Create acronyms from your bullet list to lock in sequences.",
        "Space reviews across several days instead of one long cram session.",
    ]
    if keywords:
        tips.append(
            f"Link keywords ({', '.join(keywords[:4])}) to vivid mental images or stories."
        )
    return tips


def _related_topics(keywords: list[str]) -> list[str]:
    if not keywords:
        return ["Review prerequisite concepts from your course syllabus."]
    return [f"Explore how **{kw.title()}** connects to broader themes in this subject." for kw in keywords[:5]]


def build_study_notes_markdown(notes: str, depth: str = "standard") -> str:
    """Build full structured markdown from raw notes."""
    text = _normalize(notes)
    paragraphs = _split_paragraphs(notes)
    all_sentences: list[str] = []
    for p in paragraphs:
        all_sentences.extend(_split_sentences(p))
    if not all_sentences:
        all_sentences = [s for s in re.split(r"[.!?]+", text) if len(s.strip()) > 15]
    if not all_sentences:
        all_sentences = [text[:500]]

    keywords = _top_keywords(text, n=15 if depth == "deep" else 10)
    scored = _score_sentences(all_sentences, keywords)
    top_sents = [s for _, s in scored[:6 if depth == "quick" else 10]]

    # Summary
    summary_parts = top_sents[:3 if depth == "quick" else 5]
    if paragraphs and paragraphs[0] not in summary_parts:
        summary_parts.insert(0, paragraphs[0][:400])

    # Bullets
    bullet_count = 6 if depth == "quick" else (10 if depth == "standard" else 14)
    bullets = top_sents[:bullet_count]

    definitions = _extract_definitions(notes)
    if not definitions and keywords:
        definitions = [(kw.title(), f"A central concept in these notes related to the topic of {kw}.") for kw in keywords[:4]]

    quiz = _make_quiz(all_sentences, keywords)
    takeaways = bullets[:5]
    plan = _study_plan(keywords)
    tips = _memory_tips(keywords)
    related = _related_topics(keywords)

    lines: list[str] = []
    lines.append("## 📝 Summary")
    lines.append("")
    for p in summary_parts:
        lines.append(p.strip())
        lines.append("")

    lines.append("## • Bullet Points")
    for b in bullets:
        lines.append(f"- {b.strip()}")
    lines.append("")

    lines.append("## 📖 Important Definitions")
    for term, defn in definitions:
        lines.append(f"**{term}:** {defn}")
    if not definitions:
        lines.append("- No explicit definitions detected — add `Term: meaning` lines in your notes for richer output.")
    lines.append("")

    lines.append("## ❓ Quiz Questions")
    for i, (q, a) in enumerate(quiz, 1):
        lines.append(f"{i}. **Question:** {q}")
        lines.append(f"   **Answer:** {a}")
    lines.append("")

    lines.append("## 🎯 Key Takeaways")
    for t in takeaways:
        lines.append(f"- {t.strip()}")
    lines.append("")

    lines.append("## 📅 Suggested Study Plan")
    for step in plan:
        lines.append(f"- {step}")
    lines.append("")

    lines.append("## 💡 Memory Tips")
    for tip in tips:
        lines.append(f"- {tip}")
    lines.append("")

    lines.append("## 🔗 Related Topics to Explore")
    for r in related:
        lines.append(f"- {r}")

    return "\n".join(lines)


async def stream_local_notes(notes: str, depth: str = "standard", chunk_size: int = 48) -> AsyncGenerator[str, None]:
    """Yield markdown in chunks to simulate streaming for the UI."""
    full = build_study_notes_markdown(notes, depth=depth)
    for i in range(0, len(full), chunk_size):
        yield full[i : i + chunk_size]
        await asyncio.sleep(0.012)
