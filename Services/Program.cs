// Make sure we set the current directory because otherwise we can't load appSettings.json etc.
Environment.CurrentDirectory = AppContext.BaseDirectory;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddCors(options =>
{
  options.AddDefaultPolicy(
      policy =>
      {
        // Make sure the CORS policy blocks NOTHING
        policy
          .AllowAnyOrigin()
          .AllowAnyMethod()
          .AllowAnyHeader();
      });
});

var app = builder.Build();

app.UseCors();

app.MapGet("/", () => $"It is {DateTime.Now:d MMM yyyy, HH:mm:ss}");
// This will not work without CORS AllowAnyMethod()!
app.MapPost("/", () => "This is POST /");
app.Run();
