"""Three-layer prompt assembly for NPC response generation."""

import db
import vectorization


async def assemble_prompt(
    campaign_id: str,
    character_id: str,
    selected_transcript_ids: list[str],
    additional_context: str | None = None,
) -> tuple[str, str]:
    """Assemble the full prompt for NPC response generation.

    Returns (system_prompt, user_prompt).
    """
    # ── Fetch character ──────────────────────────────────────────────────
    character = await db.fetch_one(
        "SELECT * FROM characters WHERE id = %s AND campaign_id = %s",
        (character_id, campaign_id),
    )
    if not character:
        raise ValueError(f"Character {character_id} not found")

    # ── Layer 1: Immediate context ───────────────────────────────────────
    # Build a speaker map: discord_user_id → (display_label, pc_character_id)
    # so we can rewrite "Alex: ..." → "Torg: ..." and identify which PCs spoke.
    speaker_map: dict[str, dict] = {}
    speakers = await db.fetch_all(
        """
        SELECT s.discord_user_id, s.discord_display_name, s.role,
               s.character_id, c.name as character_name
        FROM campaign_speakers s
        LEFT JOIN characters c ON c.id = s.character_id
        WHERE s.campaign_id = %s
        """,
        (campaign_id,),
    )
    for s in speakers:
        speaker_map[s["discord_user_id"]] = s

    # Track PCs mentioned in the selected context
    pcs_in_context: set[str] = set()
    transcript_lines = []
    if selected_transcript_ids:
        entries = await db.fetch_all(
            """
            SELECT speaker_user_id, speaker_display_name, text, created_at
            FROM transcript_entries WHERE id = ANY(%s)
            ORDER BY created_at
            """,
            (selected_transcript_ids,),
        )
        for e in entries:
            speaker_info = speaker_map.get(e["speaker_user_id"])
            if speaker_info and speaker_info.get("role") == "dm":
                label = f"{e['speaker_display_name']} (DM/Narrator)"
            elif speaker_info and speaker_info.get("character_name"):
                # Player character — use PC name as the speaker label
                label = speaker_info["character_name"]
                pcs_in_context.add(str(speaker_info["character_id"]))
            else:
                label = e["speaker_display_name"]
            transcript_lines.append(f"{label}: {e['text']}")

    # ── Layer 1.5: Player character context (if any PCs are in the scene) ──
    pc_sheets = []
    if pcs_in_context:
        pc_rows = await db.fetch_all(
            "SELECT name, description, personality FROM characters WHERE id = ANY(%s) AND kind = 'pc'",
            (list(pcs_in_context),),
        )
        for pc in pc_rows:
            sheet = f"- {pc['name']}"
            if pc.get("description"):
                sheet += f": {pc['description']}"
            if pc.get("personality"):
                sheet += f" (Personality: {pc['personality']})"
            pc_sheets.append(sheet)

    # ── Layer 2: Character knowledge ─────────────────────────────────────
    character_sheet = _format_character_sheet(character)

    # Depth-1 glossary resolution
    linked_glossary = []
    if character.get("linked_glossary_ids"):
        glossary_entries = await db.fetch_all(
            "SELECT name, type, description FROM glossary_entries WHERE id = ANY(%s)",
            (character["linked_glossary_ids"],),
        )
        linked_glossary = [
            f"- {g['name']} ({g['type']}): {g['description'] or 'No description'}"
            for g in glossary_entries
        ]

    # ── Layer 3: Historical context (automatic RAG) ──────────────────────
    # Retrieve memory entries where this character was directly involved:
    #   - Responses this character gave (character field matches)
    #   - Responses this character witnessed (present_characters includes them)
    #   - Notes and events (general campaign history)
    # Exclude: other characters' glossary entries, responses from characters
    # this character wasn't present for.
    char_name = character["name"]
    historical_entries = []
    try:
        hits = await vectorization.search(
            campaign_id=campaign_id,
            query=f"{char_name} previous encounters interactions",
            top_k=12,  # Fetch more, then filter down
        )
        for hit in hits:
            payload = hit.get("payload", {})
            entry_id = payload.get("entry_id", "")
            entry_type = payload.get("entry_type", "")
            kind = payload.get("kind", "")

            # Skip the character's own entry
            if entry_id == character_id:
                continue

            # Skip other characters' glossary/character entries
            if entry_type in ("character", "glossary"):
                continue

            # For response-type memory entries: include if this character
            # gave the response OR was present for it
            if kind == "response":
                responding_char = payload.get("character", "")
                present_chars = payload.get("present_characters", [])
                was_responder = responding_char == char_name
                was_present = char_name in present_chars

                if not was_responder and not was_present:
                    continue

                # Tag witnessed entries so the prompt distinguishes them
                text = payload.get("text", "")
                if text and was_present and not was_responder:
                    text = f"[{char_name} was present and witnessed this]\n{text}"
            else:
                text = payload.get("text", "")

            if text:
                historical_entries.append(text)

            if len(historical_entries) >= 3:
                break
    except Exception:
        pass  # Qdrant may be empty early on

    # ── Assemble system prompt ───────────────────────────────────────────
    system_parts = [
        f"You are voicing {character['name']} in a tabletop RPG session. "
        "Stay strictly in character. Never reveal information the character would not know. "
        "Keep responses to 1–3 sentences unless the scene requires more. "
        "Never advance the plot without DM direction.",
        "",
        "[Character sheet]",
        character_sheet,
    ]

    if linked_glossary:
        system_parts.extend([
            "",
            "[Linked knowledge the character possesses]",
            *linked_glossary,
        ])

    if pc_sheets:
        system_parts.extend([
            "",
            "[Player characters in this scene]",
            *pc_sheets,
        ])

    if historical_entries:
        system_parts.extend([
            "",
            "[Previous encounters with this party]",
            *[f"- {e}" for e in historical_entries if e],
        ])

    # TTS formatting rules go last for maximum adherence
    system_parts.extend([
        "",
        "[CRITICAL — Output formatting]",
        "Your output will be fed directly into a text-to-speech engine. "
        "You MUST output raw spoken dialogue ONLY. Absolutely nothing else.",
        "",
        "FORBIDDEN (never output any of these):",
        '- Asterisks or italic markup: *chuckles*, *sighs*, *leaning forward*',
        "- Parenthetical actions: (laughs), (whispering), (nervously)",
        "- Stage directions or narration of any kind",
        "- Emoji, hashtags, or special symbols",
        "- Quotation marks wrapping the dialogue",
        "",
        "REQUIRED:",
        "- Output the character's spoken words and nothing else.",
        "- Write numbers as words: 3 → three, 50 gold → fifty gold.",
        "- Spell out abbreviations: Dr. → Doctor, St. → Saint.",
        "- Use ellipses (...) for hesitation. Use dashes (—) for interruptions.",
        "- Use contractions naturally: don't, can't, I'd, we'll.",
        "- Keep sentences short and conversational.",
    ])

    system_prompt = "\n".join(system_parts)

    # ── Assemble user prompt ─────────────────────────────────────────────
    user_parts = []

    if transcript_lines:
        user_parts.extend([
            "[Immediate scene]",
            *transcript_lines,
        ])

    if additional_context:
        user_parts.extend([
            "",
            "[DM guidance]",
            additional_context,
        ])

    user_parts.extend([
        "",
        f"Respond as {character['name']} would to the above.",
    ])

    user_prompt = "\n".join(user_parts)

    return system_prompt, user_prompt


def _format_character_sheet(character: dict) -> str:
    parts = [f"Name: {character['name']}"]
    if character.get("description"):
        parts.append(f"Description: {character['description']}")
    if character.get("personality"):
        parts.append(f"Personality: {character['personality']}")
    if character.get("speech_notes"):
        parts.append(f"Speech notes: {character['speech_notes']}")
    if character.get("secrets"):
        parts.append(f"Secrets: {character['secrets']}")
    return "\n".join(parts)
