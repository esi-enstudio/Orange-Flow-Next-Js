# Forms, Validation & Error Handling

> Detail spec referenced from [AGENTS.md](../../AGENTS.md). Rules here are binding; they are not optional guidance.

## Form Development Rules

Whenever creating any form:

The form must have:
- Frontend validation
- Backend validation
- Proper error handling
- Field type accuracy
- Security validation

---

## Input Field Type Rules

Always use the correct HTML/UI input type.

Examples:

Name:
text

Email:
email

Phone:
tel

Number:
number

Date:
date

Password:
password

Do not use generic text input for everything.

---

## Frontend Validation

Every form must validate before submission.

Validation must include:
- Required fields
- Correct format
- Minimum length
- Maximum length
- Data type
- Business rules

Validation errors must appear directly below the related field.

Example:

Email Field:
Email is required
Invalid email format

---

## Backend Validation

Frontend validation is not trusted.

FastAPI backend must validate every request.

Backend validation must include:
- Data type checking
- Required fields
- Database constraints
- Business logic validation
- Security checks

---

## Error Handling

Validation errors must return structured responses (see Error Response Standards section).

Frontend must display these messages under the correct fields.
