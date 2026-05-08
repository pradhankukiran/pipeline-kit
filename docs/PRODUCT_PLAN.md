# PipelineKit Product Plan

PipelineKit is a workstation app for AI-assisted Blender production. The AI systems coordinate production work through typed operations, approvals, checkpoints, and review loops.

## Model Roles

- Groq: fast routing, intent classification, JSON extraction, operation validation, status summaries.
- OpenRouter: creative direction, shot planning, style reasoning, vision critique, revision proposals.
- Codex SDK: local production engineer, Blender MCP control, Blender Python, project scripting, failure recovery.

Only the Codex execution lane may directly touch Blender.

## Default Asset Strategy

1. Procedural recipes create structure, lighting, cameras, motion, and render presets.
2. Poly Haven supplies CC0 HDRIs, PBR materials, textures, and selected models.
3. Local assets are opt-in per project and require approved folders.

## Primary Vertical

Product visualization in Blender:

- still product render packages
- turntable animations
- camera contact sheets
- lighting and material variants
- AI review and revision history
