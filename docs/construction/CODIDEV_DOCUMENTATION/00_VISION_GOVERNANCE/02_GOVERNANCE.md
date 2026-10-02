# Governance and Human Gates

**Version:** 1.0  
**Project:** CodiDev  
**Repository:** `github.com/Elfried002/codidev`

---

Action classes include READ, LOW_WRITE, WRITE, SENSITIVE_WRITE, DESTRUCTIVE, EXTERNAL_SIDE_EFFECT, DEPLOYMENT and SECURITY_SENSITIVE.

Critical operations require an explicit approval gate. Silence is never approval.

CodiDev must never exfiltrate data, steal secrets, bypass security controls, access another tenant, deploy production without authorization, or claim an unverified result.

## Implementation note

This document is part of the CodiDev documentation corpus. It defines behavior and boundaries for the corresponding subsystem and must be read together with the neighboring documents.
