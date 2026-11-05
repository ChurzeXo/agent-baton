# Contributing to Agent Baton

Thank you for your interest in contributing to **Agent Baton**! 
We welcome contributions from developers and researchers building the future of autonomous, verifiable multi-agent software engineering.

---

## 1. Development Principles

1. **Zero External Dependencies**:
   Baton's core CLI must remain 100% dependency-free, relying strictly on native Node.js APIs (`fs`, `path`, `crypto`, `child_process`). Do not introduce third-party npm packages into the runtime engine.
2. **Deterministic & Fail-Closed**:
   Safety gates must fail closed. When verifying evidence, ambiguity results in immediate rejection.
3. **Cross-Platform Compatibility**:
   Ensure all file paths and shell operations work seamlessly across macOS, Linux, and Windows (LF line endings, POSIX path normalization).

---

## 2. Local Setup & Testing

```bash
# Clone the repository
git clone https://github.com/ChurzeXo/agent-baton.git
cd agent-baton

# Link the development build to your local PATH
npm link
baton link

# Run self-check tests
npm test
```

---

## 3. Pull Request Guidelines

1. **Keep Changes Minimal & Focused**: One feature or bug fix per PR.
2. **Update Specifications**: If changing state machine behavior, update `DESIGN.md` and `COMMANDS.md`.
3. **Commit Messages**: Follow standard Conventional Commits (`feat: ...`, `fix: ...`, `docs: ...`).

---

## 4. Community & Code of Conduct

We are committed to providing a welcoming, harassment-free environment for everyone. Please be respectful and constructive in all discussions.
