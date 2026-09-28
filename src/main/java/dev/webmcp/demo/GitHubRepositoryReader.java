package dev.webmcp.demo;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Reads a public GitHub repository and extracts Spring route annotations and frontend route hints. */
final class GitHubRepositoryReader {
    private static final Pattern REPOSITORY_URL = Pattern.compile("^https://github\\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\\.git)?/?$");
    private static final Pattern DEFAULT_BRANCH = Pattern.compile("\"default_branch\"\\s*:\\s*\"([^\"]+)\"");
    private static final Pattern TREE_ENTRY = Pattern.compile("\\{\\s*\"path\"\\s*:\\s*\"([^\"]+)\"\\s*,\\s*\"mode\"\\s*:\\s*\"[^\"]+\"\\s*,\\s*\"type\"\\s*:\\s*\"blob\"\\s*,\\s*\"sha\"\\s*:\\s*\"([0-9a-f]+)\"\\s*,\\s*\"size\"\\s*:\\s*(\\d+)");
    private static final Pattern BLOB_CONTENT = Pattern.compile("\"content\"\\s*:\\s*\"([A-Za-z0-9+/=\\\\n\\\\r]+)\"");
    private static final Pattern SPRING_MAPPING = Pattern.compile("@(Get|Post|Put|Patch|Delete)Mapping(?:\\s*\\(\\s*(?:value\\s*=\\s*|path\\s*=\\s*)?[\"']([^\"']*)[\"'][^)]*\\))?");
    private static final Pattern PATH_VARIABLE = Pattern.compile("\\{([^}:]+)(?::[^}]+)?}");
    private static final Pattern JAVASCRIPT_ROUTE = Pattern.compile("(?:path\\s*=\\s*|path\\s*:\\s*)[\"']/?([^\"']+)[\"']");

    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).build();

    WebmcpDemoApplication.Analysis analyze(String rawUrl) {
        Matcher repository = REPOSITORY_URL.matcher(rawUrl == null ? "" : rawUrl.trim());
        if (!repository.matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Enter a public GitHub URL such as https://github.com/owner/repository");
        }
        String owner = repository.group(1);
        String repo = repository.group(2);
        String apiRoot = "https://api.github.com/repos/" + owner + "/" + repo;
        try {
            String metadata = get(apiRoot);
            Matcher branchMatch = DEFAULT_BRANCH.matcher(metadata);
            if (!branchMatch.find()) throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "GitHub did not return a default branch");
            String branch = branchMatch.group(1);
            String tree = get(apiRoot + "/git/trees/" + encodePathPart(branch) + "?recursive=1");
            List<FileEntry> files = selectFiles(tree);
            List<SourceFile> sources = new ArrayList<>();
            for (FileEntry file : files) {
                String blob = get(apiRoot + "/git/blobs/" + file.sha());
                Matcher content = BLOB_CONTENT.matcher(blob);
                if (!content.find()) continue;
                String base64 = content.group(1).replace("\\n", "").replace("\\r", "");
                String text = new String(Base64.getMimeDecoder().decode(base64), StandardCharsets.UTF_8);
                sources.add(new SourceFile(file.path(), text));
            }
            return buildAnalysis(owner + "/" + repo, sources);
        } catch (ResponseStatusException exception) {
            throw exception;
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "GitHub read was interrupted", exception);
        } catch (IOException | IllegalArgumentException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Could not read this public GitHub repository: " + exception.getMessage(), exception);
        }
    }

    private String get(String url) throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(12))
                .header("Accept", "application/vnd.github+json")
                .header("X-GitHub-Api-Version", "2026-03-10")
                .header("User-Agent", "webmcp-fleet-demo")
                .GET().build();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() == 404) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Repository or source file not found on GitHub");
        if (response.statusCode() == 403) throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "GitHub's unauthenticated API limit was reached; try again later");
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "GitHub returned HTTP " + response.statusCode());
        }
        return response.body();
    }

    private List<FileEntry> selectFiles(String tree) {
        List<FileEntry> candidates = new ArrayList<>();
        Matcher entries = TREE_ENTRY.matcher(tree);
        while (entries.find()) {
            String path = entries.group(1);
            String lower = path.toLowerCase(Locale.ROOT);
            long size = Long.parseLong(entries.group(3));
            if (size > 160_000) continue;
            boolean javaSource = lower.endsWith(".java") && (lower.startsWith("src/main/java/") || lower.contains("/src/main/java/"));
            boolean openApi = (lower.endsWith(".yaml") || lower.endsWith(".yml") || lower.endsWith(".json"))
                    && (lower.contains("openapi") || lower.contains("swagger"));
            boolean frontendRoutes = (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".ts") || lower.endsWith(".tsx"))
                    && (lower.matches(".*(?:route|router|app|page)[^/]*\\.(?:js|jsx|ts|tsx)$") || lower.contains("/routes/"));
            if (javaSource || openApi || frontendRoutes) candidates.add(new FileEntry(path, entries.group(2), size));
        }
        return candidates.stream().limit(20).toList();
    }

    private WebmcpDemoApplication.Analysis buildAnalysis(String repository, List<SourceFile> sources) {
        List<WebmcpDemoApplication.Capability> capabilities = new ArrayList<>();
        Set<String> controllers = new TreeSet<>();
        Set<String> routes = new TreeSet<>();
        Map<String, String> javaSources = new LinkedHashMap<>();
        boolean isSpring = false;
        for (SourceFile file : sources) {
            String lower = file.path().toLowerCase(Locale.ROOT);
            if (lower.endsWith(".java")) {
                javaSources.put(file.path(), file.content());
                if (file.content().contains("org.springframework") || file.content().contains("@RestController")) isSpring = true;
            } else if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".ts") || lower.endsWith(".tsx")) {
                scanFrontendFile(file.content(), routes);
            } else if (lower.contains("openapi") || lower.contains("swagger")) {
                scanOpenApiFile(file.content(), capabilities);
            }
        }
        for (Map.Entry<String, String> entry : javaSources.entrySet()) {
            scanJavaFile(new SourceFile(entry.getKey(), entry.getValue()), capabilities, controllers, javaSources);
        }
        capabilities = capabilities.stream().collect(
                java.util.stream.Collectors.toMap(WebmcpDemoApplication.Capability::name, capability -> capability,
                        (first, ignored) -> first, TreeMap::new)).values().stream().toList();
        String stack = isSpring ? "Spring Boot · Java" : "Java source";
        return new WebmcpDemoApplication.Analysis(repository, stack, routes.size(), capabilities.size(),
                List.copyOf(routes), capabilities, List.copyOf(controllers));
    }

    private void scanJavaFile(SourceFile file, List<WebmcpDemoApplication.Capability> capabilities,
                              Set<String> controllers, Map<String, String> javaSources) {
        String source = file.content();
        String basePath = classBasePath(source);
        Matcher className = Pattern.compile("@(?:RestController|Controller)\\b[\\s\\S]{0,500}?\\bclass\\s+(\\w+)").matcher(source);
        if (className.find()) controllers.add(className.group(1));
        Matcher mappings = SPRING_MAPPING.matcher(source);
        while (mappings.find()) {
            String verb = mappings.group(1).toUpperCase(Locale.ROOT);
            String methodPath = mappings.group(2) == null ? "" : mappings.group(2).trim();
            String endpoint = normalizePath(basePath, methodPath);
            if (!endpoint.startsWith("/api/vehicles") && !endpoint.startsWith("/vehicles/")) continue;
            String name = toolName(verb, endpoint);
            String risk = switch (verb) {
                case "GET", "HEAD" -> "READ";
                case "POST", "PUT", "PATCH" -> "WRITE";
                case "DELETE" -> "DESTRUCTIVE";
                default -> "REVIEW";
            };
            String inputNames = pathInputs(endpoint);
            String trailingSource = source.substring(mappings.end(), Math.min(source.length(), mappings.end() + 1200));
            inputNames = bodyInputs(trailingSource, javaSources, inputNames);
            String description = risk.equals("WRITE")
                    ? "Creates or changes vehicle data after user confirmation."
                    : "Returns data from " + endpoint + ".";
            capabilities.add(new WebmcpDemoApplication.Capability(name, humanize(name), description, risk,
                    verb, endpoint, inputNames, !risk.equals("DESTRUCTIVE") && !risk.equals("REVIEW")));
        }
    }

    private String classBasePath(String source) {
        Matcher methodMapping = SPRING_MAPPING.matcher(source);
        if (!methodMapping.find()) return "";
        int annotation = source.lastIndexOf("@RequestMapping", methodMapping.start());
        if (annotation < 0 || methodMapping.start() - annotation > 600) return "";
        int end = source.indexOf(')', annotation);
        if (end < 0 || end > methodMapping.start()) return "";
        Matcher value = Pattern.compile("[\"']([^\"']+)[\"']").matcher(source.substring(annotation, end + 1));
        return value.find() ? value.group(1) : "";
    }

    private String normalizePath(String base, String path) {
        String joined = (base.endsWith("/") ? base.substring(0, base.length() - 1) : base)
                + "/" + (path.startsWith("/") ? path.substring(1) : path);
        joined = joined.replaceAll("/{2,}", "/");
        return joined.isBlank() ? "/" : joined;
    }

    private String toolName(String verb, String endpoint) {
        String remainder = endpoint.replaceFirst("^/api/vehicles", "").replaceFirst("^/vehicles", "").replaceAll("\\{[^}]+}", "");
        List<String> nouns = Arrays.stream(remainder.split("/")).filter(part -> !part.isBlank()).toList();
        if (nouns.isEmpty()) {
            if (verb.equals("GET") && endpoint.contains("{")) return "getVehicle";
            return verb.equals("GET") ? "listVehicles" : verb.toLowerCase(Locale.ROOT) + "Vehicle";
        }
        String action = switch (verb) {
            case "GET", "HEAD" -> "get";
            case "POST" -> "create";
            case "PUT", "PATCH" -> "update";
            case "DELETE" -> "delete";
            default -> "call";
        };
        return action + "Vehicle" + nouns.stream().map(noun -> verb.equals("POST") ? singularize(noun) : noun)
                .map(this::capitalize).reduce("", String::concat);
    }

    private String pathInputs(String path) {
        LinkedHashSet<String> inputs = new LinkedHashSet<>();
        Matcher match = PATH_VARIABLE.matcher(path);
        while (match.find()) inputs.add(match.group(1));
        return String.join(", ", inputs);
    }

    private String bodyInputs(String methodSource, Map<String, String> javaSources, String inputs) {
        Matcher body = Pattern.compile("@RequestBody\\s+(\\w+)\\s+\\w+").matcher(methodSource);
        if (!body.find()) return inputs.isBlank() ? "none" : inputs;
        String type = body.group(1);
        for (String source : javaSources.values()) {
            Matcher record = Pattern.compile("record\\s+" + Pattern.quote(type) + "\\s*\\(([^)]*)\\)").matcher(source);
            if (!record.find()) continue;
            Matcher field = Pattern.compile("(?:[\\w<>?,.]+\\s+)(\\w+)\\s*(?:,|$)").matcher(record.group(1));
            List<String> bodyFields = new ArrayList<>();
            while (field.find()) bodyFields.add(field.group(1));
            if (bodyFields.isEmpty()) bodyFields.add(type);
            LinkedHashSet<String> all = new LinkedHashSet<>();
            if (!inputs.isBlank() && !inputs.equals("none")) all.addAll(Arrays.asList(inputs.split(",\\s*")));
            all.addAll(bodyFields);
            return String.join(", ", all);
        }
        return inputs.isBlank() ? type : inputs + ", " + type;
    }

    private void scanFrontendFile(String source, Set<String> routes) {
        Matcher matches = JAVASCRIPT_ROUTE.matcher(source);
        while (matches.find()) routes.add("/" + matches.group(1).replaceFirst("^/+", ""));
        if (source.contains("#/fleet")) routes.add("/fleet");
        if (source.contains("state.route.match") && source.contains("/fleet/")) routes.add("/fleet/{vin}");
        if (source.contains("#/studio")) routes.add("/studio");
    }

    private void scanOpenApiFile(String source, List<WebmcpDemoApplication.Capability> capabilities) {
        Matcher paths = Pattern.compile("(?m)^\\s{2}(/api/vehicles[^\\s:]*):\\s*$").matcher(source);
        List<String> lines = Arrays.asList(source.split("\\R"));
        while (paths.find()) {
            String path = paths.group(1);
            int lineNumber = source.substring(0, paths.start()).split("\\R", -1).length;
            for (int i = lineNumber; i < Math.min(lines.size(), lineNumber + 12); i++) {
                Matcher method = Pattern.compile("^\\s{4}(get|post|put|patch|delete):\\s*$", Pattern.CASE_INSENSITIVE).matcher(lines.get(i));
                if (!method.find()) continue;
                String verb = method.group(1).toUpperCase(Locale.ROOT);
                String risk = verb.equals("GET") ? "READ" : verb.equals("DELETE") ? "DESTRUCTIVE" : "WRITE";
                String name = toolName(verb, path);
                capabilities.add(new WebmcpDemoApplication.Capability(name, humanize(name),
                        risk.equals("WRITE") ? "Creates or changes vehicle data after user confirmation." : "Returns data from " + path + ".",
                        risk, verb, path, pathInputs(path), !risk.equals("DESTRUCTIVE")));
            }
        }
        Matcher jsonPaths = Pattern.compile("\"(/api/vehicles[^\"]*)\"\\s*:\\s*\\{([^}]{1,2400})}").matcher(source);
        while (jsonPaths.find()) {
            String path = jsonPaths.group(1);
            Matcher methods = Pattern.compile("\"(get|post|put|patch|delete)\"\\s*:", Pattern.CASE_INSENSITIVE).matcher(jsonPaths.group(2));
            while (methods.find()) {
                String verb = methods.group(1).toUpperCase(Locale.ROOT);
                String risk = verb.equals("GET") ? "READ" : verb.equals("DELETE") ? "DESTRUCTIVE" : "WRITE";
                String name = toolName(verb, path);
                capabilities.add(new WebmcpDemoApplication.Capability(name, humanize(name),
                        risk.equals("WRITE") ? "Creates or changes vehicle data after user confirmation." : "Returns data from " + path + ".",
                        risk, verb, path, pathInputs(path), !risk.equals("DESTRUCTIVE")));
            }
        }
    }

    private String singularize(String word) {
        if (word.endsWith("ies") && word.length() > 3) return word.substring(0, word.length() - 3) + "y";
        if (word.endsWith("s") && !word.endsWith("ss")) return word.substring(0, word.length() - 1);
        return word;
    }

    private String humanize(String name) {
        String words = name.replaceAll("([a-z])([A-Z])", "$1 $2").toLowerCase(Locale.ROOT);
        return capitalize(words);
    }

    private String capitalize(String text) {
        return text.isEmpty() ? text : text.substring(0, 1).toUpperCase(Locale.ROOT) + text.substring(1);
    }

    private String encodePathPart(String path) {
        return URLEncoder.encode(path, StandardCharsets.UTF_8).replace("+", "%20");
    }

    private record FileEntry(String path, String sha, long size) {}
    private record SourceFile(String path, String content) {}
}
