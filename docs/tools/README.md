# Learning document sources

`study-content.mjs` is the shared Korean text for the Markdown and PDF. `study-diagrams.mjs` draws original SVGs without remote assets. `build-study.mjs` renders both, reads the recorded implementation commit/test count from `../learning/verification.json`, and copies SVG/PNG assets alongside the output Markdown.

The renderer is documentation tooling; it is not an application dependency and is excluded from the extension ZIP. It requires Node, ImageMagick with SVG support, the local Nanum fonts listed in the renderer, and a separate directory containing `pdfkit@0.21.0` and `svg-to-pdfkit@0.1.8`. The source commit must exist locally, and the report version must match package.json. Updating the report requires actual verification; the renderer does not perform a security review.

Example using already prepared tools:

```bash
node docs/tools/build-study.mjs /tmp/usagescope-doc-tools "$HOME/Documents"
```

This explicitly writes `UsageScope_설계와_기술선택_학습자료.md`, the matching PDF and `UsageScope_학습자료_리소스/` in the requested destination, and updates the repository Markdown/assets. Existing files with these generated names are replaced; other Documents files are not touched. PDF text uses embedded fonts and the diagrams are native vector graphics.
