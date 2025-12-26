# pupsourcing-website

Documentation website for the [getpup/pupsourcing](https://github.com/getpup/pupsourcing) project - Clean Event Sourcing library written in Go.

## Overview

This repository hosts the documentation website for pupsourcing, built with [MkDocs](https://www.mkdocs.org/) and the [Material for MkDocs](https://squidfunk.github.io/mkdocs-material/) theme.

## Local Development

### Prerequisites

- Python 3.8+
- pip

### Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Run the development server:
```bash
mkdocs serve
```

3. Open your browser to [http://localhost:8000](http://localhost:8000)

The site features:
- 🌓 **Light/Dark mode** with automatic detection based on your system preference
- 🎨 **Modern, lightweight design** built on Material for MkDocs
- 🔍 **Fast search** with suggestions and highlighting
- 📱 **Responsive** layout for all devices
- ⚡ **Instant navigation** for fast page loads

### Building the Site

Build the static site:
```bash
mkdocs build
```

The built site will be in the `site/` directory.

## Documentation Structure

- `mkdocs.yml` - MkDocs configuration
- `docs/` - Documentation content
  - `assets/` - Images, logos, and custom CSS
  - `index.md` - Landing page with event sourcing introduction
  - `getting-started.md` - Installation and quick start
  - `core-concepts.md` - Event sourcing fundamentals
  - `adapters.md` - Database adapter documentation
  - `scaling.md` - Projections and scaling guide
  - `api-reference.md` - Complete API documentation
  - And more...

## Deployment

The site can be deployed to GitHub Pages or any static hosting service.

### GitHub Pages

```bash
mkdocs gh-deploy
```

This builds the site and pushes it to the `gh-pages` branch.

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test locally with `mkdocs serve`
5. Submit a pull request

## License

MIT License - see the [pupsourcing LICENSE](https://github.com/getpup/pupsourcing/blob/main/LICENSE)
