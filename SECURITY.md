# Security Policy

## Supported Versions

We actively maintain and provide security updates for the following versions:

| Version | Supported |
| ------- | --------- |
| 5.1.x   | :white_check_mark: |
| 5.0.x   | :x: |
| 4.0.x   | :white_check_mark: |
| < 4.0   | :x: |

Only supported versions receive security fixes. Users should upgrade to the latest supported version whenever possible.

---

# Reporting a Vulnerability

The security of this project is important to us. We appreciate responsible disclosure from security researchers and the community.

If you discover a security vulnerability, please report it privately.

## How to Report

Please report security issues through:

- GitHub Security Advisories:
  - Open this repository.
  - Go to the **Security** tab.
  - Select **Report a vulnerability**.

Do not create a public GitHub issue for security vulnerabilities.

Public disclosure before a fix is available may put users at risk.

---

# Vulnerability Report Information

Please include the following details in your report:

- Vulnerability description.
- Affected component or file.
- Affected versions.
- Steps to reproduce the issue.
- Proof of concept (if available).
- Security impact.
- Suggested mitigation or fix.

The more details provided, the faster we can investigate and resolve the issue.

---

# Response Timeline

After receiving a vulnerability report, we will:

| Action | Expected Time |
| ------ | ------------- |
| Initial acknowledgement | Within 48 hours |
| Security investigation | Within 7 days |
| Fix or mitigation plan | As soon as possible |

The timeline may change depending on the complexity and severity of the issue.

---

# Security Update Process

When a vulnerability is confirmed:

1. The issue will be reviewed and verified.
2. The severity and impact will be assessed.
3. A security fix will be developed.
4. The fix will be tested.
5. A security update will be released.

Security updates will be published through official project channels.

---

# API Keys, Tokens, and Secrets Protection

Never commit sensitive information to this repository.

The following must never be uploaded:

- API keys
- Access tokens
- Passwords
- Database credentials
- Private keys
- Encryption keys
- Cloud provider credentials
- `.env` files
- Configuration files containing secrets

Example of unsafe code:

```javascript
const API_KEY = "my-secret-api-key";
