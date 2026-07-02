# Database ERD

```mermaid
erDiagram
  Organization ||--o{ Workspace : owns
  Organization ||--o{ User : contains
  Workspace ||--o{ Membership : has
  User ||--o{ Membership : joins
  Role ||--o{ Membership : grants
  Workspace ||--o{ Contact : owns
  Contact ||--o{ Conversation : starts
  Conversation ||--o{ Message : contains
  Workspace ||--o{ WhatsAppAccount : connects
  WhatsAppAccount ||--o{ Template : syncs
  Contact ||--o{ Lead : creates
  Conversation ||--o{ Lead : qualifies
  Workspace ||--o{ Campaign : runs
  Template ||--o{ Campaign : powers
  Workspace ||--o{ AutomationFlow : owns
  Workspace ||--o{ WebhookEvent : records
  Workspace ||--o{ AuditLog : records
  Contact ||--o{ AiMemory : remembers
  Workspace ||--o{ AiDocument : indexes

  Organization {
    ObjectId _id
    string name
    string slug
    string plan
    string billingStatus
  }
  Workspace {
    ObjectId _id
    ObjectId organizationId
    string name
    string slug
    mixed settings
  }
  Contact {
    ObjectId _id
    ObjectId workspaceId
    string name
    string phone
    string waName
    string lifecycleStatus
  }
  Conversation {
    ObjectId _id
    ObjectId workspaceId
    ObjectId contactId
    string status
    date lastMessageAt
  }
  Message {
    ObjectId _id
    ObjectId conversationId
    string direction
    string type
    string status
    string providerMessageId
  }
  Lead {
    ObjectId _id
    ObjectId contactId
    string stage
    number score
    string status
  }
```

## Indexing Notes

- `Message`: `{ conversationId, createdAt }`, `{ workspaceId, providerMessageId }`, `{ workspaceId, clientMessageId }`.
- `Conversation`: `{ workspaceId, status, lastMessageAt }`, `{ workspaceId, assignedToUserId, status }`.
- `Contact`: `{ workspaceId, phone }` unique.
- `Lead`: `{ workspaceId, contactId, status }`, `{ workspaceId, stage, lastActivityAt }`.
- `WebhookEvent` and `AuditLog`: `{ workspaceId, createdAt }`.
