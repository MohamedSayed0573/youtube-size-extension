# Contributing to YouTube Size Extension

Thank you for your interest in contributing! This document provides guidelines and instructions for
contributing to the project.

## Code Quality Standards

### Formatting and Linting

We use Prettier and ESLint to maintain consistent code quality:

```bash
# Install dependencies
npm install

# Format all code
npm run format

# Check formatting without making changes
npm run format:check

# Run linting
npm run lint

# Auto-fix linting issues
npm run lint:fix

# Run both checks
npm run check
```

**Before committing**, always run:

```bash
npm run format && npm run lint:fix
```

### Code Style Guidelines

- **Indentation**: 4 spaces for JavaScript, 2 spaces for JSON/HTML
- **Quotes**: Double quotes for strings
- **Semicolons**: Always use semicolons
- **Line Length**: Maximum 80 characters (100 for Markdown)
- **Trailing Commas**: ES5 style (objects, arrays)

### Documentation Requirements

All functions must have JSDoc comments including:

- Brief description
- `@param` for each parameter with type and description
- `@returns` with type and description
- `@throws` if the function can throw errors
- `@example` for complex functions

Example:

```javascript
/**
 * Extracts the video ID from various YouTube URL formats
 *
 * @param {string} url - The YouTube URL to parse
 * @returns {string|null} The video ID (11-character string) or null if not found
 * @throws {TypeError} If url is not a string
 * @example
 *   extractVideoId('https://youtube.com/watch?v=dQw4w9WgXcQ') // 'dQw4w9WgXcQ'
 */
function extractVideoId(url) {
    // Implementation
}
```

## Development Workflow

### 1. Fork and Clone

```bash
git clone https://github.com/your-username/youtube-size-extension.git
cd youtube-size-extension
npm install
```

### 2. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/issue-description
```

### 3. Make Changes

- Write clear, self-documenting code
- Add JSDoc comments for all functions
- Follow the existing code structure
- Update documentation if adding features

### 4. Test Your Changes

- Load the extension in Chrome/Firefox
- Test on multiple YouTube video types
- Verify no console errors
- Check that existing features still work

### 5. Format and Lint

```bash
npm run format
npm run lint:fix
```

### 6. Commit

Use clear, descriptive commit messages:

```bash
git commit -m "Add support for 2160p resolution

- Added format ID 401 to video format mappings
- Updated options page with 2160p checkbox
- Updated cache structure to include s2160p
- Tested on actual 4K YouTube videos"
```

### 7. Push and Create PR

```bash
git push origin feature/your-feature-name
```

Then create a Pull Request on GitHub with:

- Clear title describing the change
- Description of what changed and why
- Screenshots for UI changes
- Testing performed
- Any breaking changes

## Pull Request Guidelines

### PR Title Format

- `feat: Add 2160p resolution support`
- `fix: Resolve cache invalidation issue`
- `docs: Update API reference for new methods`
- `refactor: Simplify badge management logic`
- `test: Add unit tests for URL parsing`
- `chore: Update dependencies`

### PR Description Template

```markdown
## Description

Brief description of changes

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing

- [ ] Tested on Chrome
- [ ] Tested on Firefox
- [ ] Tested on multiple video types
- [ ] No console errors

## Screenshots

(If applicable)

## Checklist

- [ ] Code formatted with Prettier
- [ ] Linting passes
- [ ] JSDoc comments added
- [ ] Documentation updated
- [ ] Commit messages are clear
```

## Coding Best Practices

### Error Handling

Always handle errors gracefully:

```javascript
// ✅ Good
try {
    const result = await fetchData();
    return result;
} catch (error) {
    console.error("Failed to fetch data:", error.message);
    return null; // or throw with context
}

// ❌ Avoid silent failures in critical paths
try {
    await criticalOperation();
} catch (_) {
    // Don't ignore important errors
}
```

### Async/Await

Prefer async/await over callbacks:

```javascript
// ✅ Good
async function loadData() {
    const data = await fetchData();
    return processData(data);
}

// ❌ Avoid
function loadData(callback) {
    fetchData((err, data) => {
        if (err) return callback(err);
        processData(data, callback);
    });
}
```

### Constants

Use meaningful constant names:

```javascript
// ✅ Good
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RETRIES = 3;

// ❌ Avoid magic numbers
if (elapsed > 86400000) {
    /* what is this? */
}
```

### Naming Conventions

- **Functions**: `camelCase` - `prefetchForUrl`, `getBadgeStatus`
- **Constants**: `UPPER_SNAKE_CASE` - `HOST_NAME`, `DEFAULT_TTL`
- **Private helpers**: Prefix with `_` - `_dbg`, `_validateInput`
- **Boolean variables**: Use `is`, `has`, `should` prefix - `isYouTubeUrl`, `hasCache`

## Testing Checklist

Before submitting a PR, verify:
 
- [ ] Extension loads without errors
- [ ] All existing features work
- [ ] New features work as expected
- [ ] No console errors or warnings
- [ ] Badge indicators work correctly
- [ ] Options page saves settings
- [ ] Works on standard YouTube URLs
- [ ] Works on YouTube Shorts
- [ ] Works on youtu.be short URLs
- [ ] Cache invalidation works
- [ ] Manual refresh works
- [ ] Cross-browser compatible (if applicable)

## Security Considerations

- Never commit sensitive data (API keys, passwords)
- Validate all user inputs
- Sanitize URLs before passing to yt-dlp
- Use `chrome.storage` APIs, not localStorage for extension data
- Follow principle of least privilege for permissions

## Questions?

- Check [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) for development setup
- Check [ARCHITECTURE.md](ARCHITECTURE.md) for system design
- Check [API_REFERENCE.md](API_REFERENCE.md) for API documentation
- Open an issue for questions or discussions

## License

By contributing, you agree that your contributions will be licensed under the same license as the
project (MIT).
