"""Refresh the real LeetCode GraphQL responses used by extractor.test.cjs.

Uses the same public query the extension's content script sends from the problem page.
Run: python tests/extension/fetch_fixtures.py
"""

import json
import pathlib
import urllib.request

SLUGS = [
    "two-sum",  # Easy, classic <pre> examples
    "longest-palindromic-substring",  # Medium, strings/DP
    "median-of-two-sorted-arrays",  # Hard
    "add-two-numbers",  # images in statement, linked list
    "lru-cache",  # design problem, class starter code
    "maximum-area-of-longest-diagonal-rectangle",  # math symbols, HTML comments in examples
    "maximum-difference-between-even-and-odd-frequency-i",  # newer "example-block" markup
    "combine-two-tables",  # database problem (SQL snippets)
    "meeting-rooms",  # premium: content not available without subscription
]

QUERY = """query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId questionFrontendId title titleSlug difficulty isPaidOnly content
    topicTags { name slug }
    codeSnippets { lang langSlug code }
  }
}"""

out = pathlib.Path(__file__).parent / "fixtures"
out.mkdir(exist_ok=True)
for slug in SLUGS:
    body = json.dumps({"query": QUERY, "variables": {"titleSlug": slug}}).encode()
    req = urllib.request.Request(
        "https://leetcode.com/graphql",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Referer": f"https://leetcode.com/problems/{slug}/",
            "User-Agent": "Mozilla/5.0",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        data = json.load(res)
    (out / f"{slug}.json").write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    q = data["data"]["question"]
    print(slug, q["difficulty"], "content" if q["content"] else "NO CONTENT", len(q["codeSnippets"] or []), "snippets")
