# Security policy

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository:
https://github.com/thirtykdev/archipelago/security/advisories/new

It is private to the maintainers and needs only a GitHub account. Include
what you found, how to reproduce it, and the impact you expect. Do not
include customer data.

## What to expect

- Acknowledgement within 72 hours.
- Confirmation or a request for detail within 7 days.
- A fix, a release and an advisory (with a CVE where applicable), coordinated
  with you on timing. Default: 90 days or the release, whichever is first.
- Credit in the advisory unless you ask us not to.

## Scope

In scope: code in this repository, its releases, and
https://www.archipelago-project.org. Out of scope: vendor platforms
(Niagara, Metasys and others), which have their own disclosure programs,
and third-party services we do not operate.

Please do not test against a building you are not authorized to operate,
access data that is not yours, or run denial-of-service tests.

## Incident response

If a vulnerability affects a release: contain (pull the release, revoke any
tokens), notify affected operators within 72 hours, publish an advisory.
The threat model is published at
https://www.archipelago-project.org/security/threat-model/.
