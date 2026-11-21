# Acme Robotics IT Security Policy

This policy defines the minimum security requirements for everyone who uses Acme Robotics systems. Acme Robotics is a fictional company used for demos. Violations may lead to revoked access.

## Accounts and Passwords

Passwords must be at least 14 characters long. Use a passphrase, for example several unrelated words, rather than a short complex password.

Every employee must use the company password manager. Reusing your company password on any other website is not allowed.

### Multi-Factor Authentication

Multi-factor authentication (MFA) is mandatory for email, the HR portal, source code hosting and all cloud consoles. Use the authenticator app or a hardware security key; SMS codes are not accepted as a second factor.

If you lose your hardware key or phone, contact the IT service desk immediately so the device can be revoked.

## Devices

### Laptops

All company laptops must have full-disk encryption enabled and must lock automatically after 5 minutes of inactivity. Operating system updates must be installed within 7 days of release.

Never leave a laptop unattended in a car or public place. A lost or stolen laptop must be reported to the IT service desk within 1 hour.

### Personal Devices

Personal phones may be used for company email and chat only if they are enrolled in mobile device management (MDM). Company data must never be stored on personal laptops.

## Data Classification

Acme Robotics uses three data classes:

- **Public**: approved for publication, such as marketing material.
- **Internal**: everyday business information, such as this policy. Do not share it outside the company.
- **Confidential**: customer data, personal data of employees, source code and financial results. Access is granted on a need-to-know basis and confidential data must be encrypted in transit and at rest.

Confidential data must never be pasted into external AI tools or chatbots that are not approved by the security team.

## Software

Only software from the approved software catalogue may be installed on company devices. To request new software, open a ticket with the IT service desk; the security team reviews requests within 3 working days.

## Incident Reporting

Report any suspected security incident to security@acme.example or the #security-incidents channel within 1 hour of noticing it. Examples include phishing emails you clicked on, unexpected password reset messages, or data sent to the wrong recipient.

Do not try to investigate an incident on your own and do not delete evidence such as suspicious emails. The security team responds 24/7.

### Phishing

Phishing emails often create urgency or ask for credentials. Use the "Report phishing" button in your email client. Every employee receives simulated phishing emails several times a year as part of security training.

## Security Training

Security awareness training is mandatory for all employees during their first week and must be repeated every 12 months. Employees who do not complete the yearly training within 30 days of the deadline lose access to production systems until they do.
