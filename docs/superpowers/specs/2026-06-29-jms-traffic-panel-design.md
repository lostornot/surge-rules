# JMS Traffic Panel Design

## Goal

Build a Surge module panel that reads the Just My Socks bandwidth counter API and shows current traffic usage in the Surge information panel.

## Chosen Approach

Use Surge module arguments for configuration:

```text
JMS_API_URL=<Just My Socks Bandwidth Counter API URL>
```

This keeps the module self-contained and avoids the extra local setup request flow. The API URL is still sensitive and should not be committed with a real value.

## Files

- `modules/jms-traffic-panel.sgmodule` defines the information panel and passes `JMS_API_URL` to the script.
- `scripts/jms-traffic-panel.js` fetches the API, validates the response, formats traffic values, and returns a Surge panel payload.
- `tests/jms-traffic-panel.test.js` runs the script in a mocked Surge environment.

## Data Flow

1. Surge loads the module and provides `JMS_API_URL` through the script argument.
2. The panel script extracts the API URL from `$argument`.
3. The script sends a GET request to the Just My Socks API.
4. The script expects `monthly_bw_limit_b`, `bw_counter_b`, and `bw_reset_day_of_month`.
5. The panel displays used traffic, total traffic, remaining traffic, usage percent, reset day, and update time.

## Error Handling

The panel reports clear errors for missing API URL, failed request, non-2xx HTTP response, invalid JSON, and missing traffic fields.

## Compatibility

The script may read a previously saved `$persistentStore` URL only as a fallback, so users of the old setup flow are not immediately broken. The documented path is module arguments.

## Testing

Node tests mock `$argument`, `$httpClient`, `$persistentStore`, and `$done`. Tests cover argument parsing, successful rendering, missing configuration, invalid JSON, and missing API fields.
