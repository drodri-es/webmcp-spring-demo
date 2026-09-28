package dev.webmcp.demo;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.concurrent.CopyOnWriteArrayList;

@SpringBootApplication
public class WebmcpDemoApplication {
    public static void main(String[] args) {
        SpringApplication.run(WebmcpDemoApplication.class, args);
    }

    @RestController
    @RequestMapping("/api")
    static class DemoApi {
        private final Map<String, Vehicle> vehicles = new LinkedHashMap<>();
        private final Map<String, List<Incident>> incidents = new HashMap<>();
        private final Set<String> published = new LinkedHashSet<>();
        private final RequestMappingHandlerMapping handlerMapping;

        DemoApi(RequestMappingHandlerMapping handlerMapping) {
            this.handlerMapping = handlerMapping;

            vehicles.put("WVW123456", new Vehicle("WVW123456", "Volkswagen ID.4", "2024", "Active", 82, "Madrid", "fleet-04", "Premium", "Electrical · Battery health stable"));
            vehicles.put("TESLA77821", new Vehicle("TESLA77821", "Tesla Model 3", "2023", "Attention", 34, "Barcelona", "fleet-02", "Standard", "Electrical · Battery range below target"));
            vehicles.put("BMW550091", new Vehicle("BMW550091", "BMW iX3", "2024", "Active", 96, "Valencia", "fleet-07", "Premium", "Inspection · All systems nominal"));
            vehicles.put("AUDI009712", new Vehicle("AUDI009712", "Audi Q4 e-tron", "2022", "Service due", 18, "Sevilla", "fleet-03", "Standard", "Service · Inspection overdue by 12 days"));
            incidents.put("WVW123456", new CopyOnWriteArrayList<>(List.of(
                    new Incident("INC-2048", "Battery range below expected", "HIGH", "Open", "Energy consumption is 18% above the fleet average on recent trips.", "2025-06-14"),
                    new Incident("INC-1982", "Rear sensor calibration", "LOW", "Resolved", "Parking sensor recalibrated during scheduled service.", "2025-05-29")
            )));
            incidents.put("TESLA77821", new CopyOnWriteArrayList<>(List.of(
                    new Incident("INC-2054", "Battery range degradation", "HIGH", "Open", "Estimated range dropped 14% over the last month.", "2025-06-16"),
                    new Incident("INC-2011", "Cabin filter replacement", "LOW", "Open", "Filter replacement recommended at next service.", "2025-06-02")
            )));
            incidents.put("BMW550091", new CopyOnWriteArrayList<>());
            incidents.put("AUDI009712", new CopyOnWriteArrayList<>(List.of(
                    new Incident("INC-2039", "Scheduled inspection overdue", "MEDIUM", "Open", "Annual inspection is overdue by 12 days.", "2025-06-12")
            )));
        }

        @GetMapping("/vehicles")
        List<Vehicle> vehicles() { return List.copyOf(vehicles.values()); }

        @GetMapping("/vehicles/{vin}")
        Vehicle vehicle(@PathVariable String vin) { return requireVehicle(vin); }

        @GetMapping("/vehicles/{vin}/incidents")
        List<Incident> incidents(@PathVariable String vin) {
            requireVehicle(vin);
            return List.copyOf(incidents.get(vin));
        }

        @PostMapping("/vehicles/{vin}/incidents")
        Incident createIncident(@PathVariable String vin, @RequestBody CreateIncident request) {
            requireVehicle(vin);
            if (request.title() == null || request.title().isBlank()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Incident title is required");
            }
            String id = "INC-" + (2100 + incidents.values().stream().mapToInt(List::size).sum());
            Incident incident = new Incident(id, request.title().trim(),
                    request.severity() == null ? "MEDIUM" : request.severity().toUpperCase(Locale.ROOT),
                    "Open", request.description() == null ? "Created from the WebMCP assistant." : request.description().trim(),
                    Instant.now().toString().substring(0, 10));
            incidents.get(vin).add(0, incident);
            return incident;
        }

        @GetMapping("/vehicles/{vin}/tests")
        List<TestResult> tests(@PathVariable String vin) {
            Vehicle vehicle = requireVehicle(vin);
            return List.of(
                    new TestResult("Battery health", vehicle.battery() > 50 ? "Passed" : "Review", vehicle.battery() + "% capacity", "Today"),
                    new TestResult("Safety systems", "Passed", "8 of 8 checks passed", "Yesterday"),
                    new TestResult("Scheduled inspection", vehicle.status().equals("Service due") ? "Due" : "Passed", vehicle.status().equals("Service due") ? "Overdue by 12 days" : "Next check in 42 days", "Jun 12")
            );
        }

        @PostMapping("/platform/analyze")
        Analysis analyze() {
            List<Capability> capabilities = discoverCapabilities();
            List<String> routes = discoverFrontendRoutes();
            Set<String> controllerNames = new TreeSet<>();
            handlerMapping.getHandlerMethods().forEach((mapping, handler) -> {
                if (handler.getBeanType().getPackageName().startsWith("dev.webmcp.demo")
                        && mapping.getPatternValues().stream().anyMatch(path -> path.startsWith("/api/vehicles"))) {
                    controllerNames.add(handler.getBeanType().getSimpleName().replace("WebmcpDemoApplication$", ""));
                }
            });
            return new Analysis("fleet-service", "Spring Boot · Vanilla JS", routes.size(), capabilities.size(),
                    routes, capabilities, List.copyOf(controllerNames));
        }

        @PostMapping("/platform/publish")
        Map<String, Object> publish(@RequestBody PublishRequest request) {
            published.clear();
            for (String name : request.tools()) {
                discoverCapabilities().stream().filter(c -> c.name().equals(name) && c.publishable()).findFirst()
                        .ifPresent(c -> published.add(c.name()));
            }
            return Map.of("published", true, "count", published.size(), "tools", currentTools());
        }

        @GetMapping("/platform/manifest")
        Manifest manifest() {
            return new Manifest(true, List.copyOf(published), published.isEmpty() ? "Waiting for published tools" : "Connected");
        }

        @GetMapping("/platform/tools")
        List<Capability> currentTools() {
            return discoverCapabilities().stream().filter(c -> published.contains(c.name())).toList();
        }

        private List<Capability> discoverCapabilities() {
            Map<RequestMappingInfo, HandlerMethod> mappings = handlerMapping.getHandlerMethods();
            List<Capability> capabilities = new ArrayList<>();
            for (Map.Entry<RequestMappingInfo, HandlerMethod> entry : mappings.entrySet()) {
                RequestMappingInfo mapping = entry.getKey();
                HandlerMethod handler = entry.getValue();
                if (!handler.getBeanType().getPackageName().startsWith("dev.webmcp.demo")) continue;
                Set<String> paths = new TreeSet<>(mapping.getPatternValues());
                for (String path : paths) {
                    if (!path.startsWith("/api/vehicles")) continue;
                    for (RequestMethod method : new TreeSet<>(mapping.getMethodsCondition().getMethods())) {
                        String risk = switch (method) {
                            case GET, HEAD -> "READ";
                            case POST, PUT, PATCH -> "WRITE";
                            case DELETE -> "DESTRUCTIVE";
                            default -> "REVIEW";
                        };
                        String name = toolName(method, path);
                        String label = humanize(name);
                        String description = risk.equals("WRITE")
                                ? "Creates or changes vehicle data after user confirmation."
                                : "Returns data from " + path + ".";
                        capabilities.add(new Capability(name, label, description, risk, method.name(), path,
                                discoverInputs(handler, path), !risk.equals("DESTRUCTIVE") && !risk.equals("REVIEW")));
                    }
                }
            }
            capabilities.sort(Comparator.comparing(Capability::endpoint).thenComparing(Capability::method));
            return List.copyOf(capabilities);
        }

        private String discoverInputs(HandlerMethod handler, String path) {
            LinkedHashSet<String> inputs = new LinkedHashSet<>();
            Matcher pathVariables = Pattern.compile("\\{([^}:]+)(?::[^}]+)?}").matcher(path);
            while (pathVariables.find()) inputs.add(pathVariables.group(1));
            for (var parameter : handler.getMethodParameters()) {
                if (parameter.hasParameterAnnotation(RequestBody.class)) {
                    Class<?> bodyType = parameter.getParameterType();
                    if (bodyType.isRecord()) {
                        for (var component : bodyType.getRecordComponents()) inputs.add(component.getName());
                    } else {
                        inputs.add(bodyType.getSimpleName());
                    }
                }
            }
            return inputs.isEmpty() ? "none" : String.join(", ", inputs);
        }

        private String toolName(RequestMethod method, String path) {
            String remainder = path.substring("/api/vehicles".length()).replaceAll("\\{[^}]+}", "");
            List<String> nouns = Arrays.stream(remainder.split("/"))
                    .filter(part -> !part.isBlank()).toList();
            if (nouns.isEmpty()) {
                if (method == RequestMethod.GET && path.contains("{")) return "getVehicle";
                return method == RequestMethod.GET ? "listVehicles" : method.name().toLowerCase(Locale.ROOT) + "Vehicle";
            }
            boolean createsResource = method == RequestMethod.POST;
            String resource = "Vehicle" + nouns.stream()
                    .map(noun -> createsResource ? singularize(noun) : noun)
                    .map(this::capitalize).reduce("", String::concat);
            String verb = switch (method) {
                case GET, HEAD -> "get";
                case POST -> "create";
                case PUT, PATCH -> "update";
                case DELETE -> "delete";
                default -> "call";
            };
            return verb + resource;
        }

        private String singularize(String word) {
            if (word.endsWith("ies") && word.length() > 3) return word.substring(0, word.length() - 3) + "y";
            if (word.endsWith("s") && !word.endsWith("ss")) return word.substring(0, word.length() - 1);
            return word;
        }

        private String capitalize(String word) {
            return word.isEmpty() ? word : word.substring(0, 1).toUpperCase(Locale.ROOT) + word.substring(1);
        }

        private String humanize(String name) {
            String words = name.replaceAll("([a-z])([A-Z])", "$1 $2").replaceAll("([A-Z])([A-Z][a-z])", "$1 $2").toLowerCase(Locale.ROOT);
            return capitalize(words);
        }

        private List<String> discoverFrontendRoutes() {
            try {
                String source = new ClassPathResource("static/app.js").getContentAsString(StandardCharsets.UTF_8);
                List<String> routes = new ArrayList<>();
                if (source.contains("\"#/fleet\"")) routes.add("/fleet");
                if (source.contains("state.route.match") && source.contains("/fleet/")) routes.add("/fleet/{vin}");
                if (source.contains("#/studio")) routes.add("/studio");
                return List.copyOf(routes);
            } catch (Exception ignored) {
                return List.of();
            }
        }

        private Vehicle requireVehicle(String vin) {
            Vehicle vehicle = vehicles.get(vin.toUpperCase(Locale.ROOT));
            if (vehicle == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Vehicle not found");
            return vehicle;
        }
    }

    record Vehicle(String vin, String model, String year, String status, int battery, String location,
                   String fleet, String plan, String summary) {}
    record Incident(String id, String title, String severity, String status, String description, String date) {}
    record CreateIncident(String title, String severity, String description) {}
    record TestResult(String name, String status, String detail, String updated) {}
    record Capability(String name, String label, String description, String risk, String method,
                      String endpoint, String inputs, boolean publishable) {}
    record Analysis(String repository, String stack, int routesFound, int endpointsFound,
                    List<String> routes, List<Capability> capabilities, List<String> controllers) {}
    record PublishRequest(List<String> tools) {}
    record Manifest(boolean tagInstalled, List<String> publishedTools, String status) {}
}
