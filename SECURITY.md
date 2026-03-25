# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in AI Review, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities
2. Email the maintainer directly with details of the vulnerability
3. Include steps to reproduce if possible
4. Allow reasonable time for a fix before public disclosure

## Security Considerations

AI Review processes code diffs and interacts with:
- **GitHub API** — requires a Personal Access Token (PAT) stored locally
- **LM Studio** — runs locally, no data leaves your machine
- **Local storage** — activity data is persisted in the browser's localStorage

### Best Practices

- Use a GitHub PAT with minimal required scopes (`repo` for private repos, `public_repo` for public)
- Keep LM Studio running locally — no cloud API calls are made
- Regularly rotate your GitHub PAT
- Review the AI-generated code review comments before acting on them
