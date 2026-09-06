# Recipe staging schema

The staging file passed to `archive-queue.mjs commit` is one JSON object:

```json
{
  "title": "小松菜の煮びたし",
  "category": "副菜",
  "minutes": 15,
  "servings": 2,
  "ingredients": [
    { "name": "小松菜", "amount": "1束" }
  ],
  "steps": [
    "小松菜を食べやすい長さに切る。"
  ],
  "image": "/archive/archives/<archive-id>/assets/image-1.jpg",
  "tags": ["野菜", "煮物"]
}
```

Required fields are `title`, `category`, non-empty `ingredients`, and non-empty `steps`.

- `category`: `主菜`, `副菜`, `汁物`, or `その他`
- `minutes`, `servings`: positive numbers; omitted values default to 30 and 2
- `ingredients`: strings or `{ "name": string, "amount": string }` objects
- `steps`: ordered strings
- `image`: optional; must exactly match an `assetPaths` value in the archive record
- `tags`: optional; at most eight short strings are retained

Source URL, source name, local HTML link, archive ID, creation time, color, and recipe ID are supplied by the commit script and must not be placed in the staging file.
