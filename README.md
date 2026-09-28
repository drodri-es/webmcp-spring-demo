# WebMCP Fleet Demo

A small Spring Boot demo for the hackathon flow: inspect live Spring MVC mappings, review discovered capabilities, publish selected tools, then use them with page context in the fleet app.

## Run with Docker

Docker Engine must be running. On this Mac, the local engine runs through Colima.

```sh
colima start
docker compose up --build
```

Open [http://localhost:8080](http://localhost:8080). Stop the app with `Ctrl+C`, or run `docker compose down` from this folder.

## Demo path

1. Open **WebMCP Studio** in the left navigation, paste a public GitHub repository URL, and select **Analyze repository**.
2. Review the read and write tools discovered from Spring annotations and OpenAPI descriptions.
3. Publish the selected capabilities.
4. Return to **Fleet overview**, open the Volkswagen ID.4, and ask the assistant to summarize it.
5. Choose **Create an incident** and confirm the write action. The incident appears in the vehicle record.

The one-line `/tag.js` script is a local stand-in for the proposed WebMCP tag. It reads the published manifest and the current route. The analyzer reads public GitHub repositories through GitHub's unauthenticated REST API, extracts Spring mapping annotations and OpenAPI paths, and checks frontend route hints. It does not read private repositories or compile/execute uploaded code. The fleet API and incident write run in Spring Boot with in-memory data.

## Local development

```sh
mvn spring-boot:run
```

The API is available under `/api`. Vehicle records reset when the app restarts.
