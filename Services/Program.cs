var builder = WebApplication.CreateBuilder(args);
builder.Services.AddCors(options =>
{
  options.AddDefaultPolicy(
      policy =>
      {
        policy.AllowAnyOrigin();
      });
});

var app = builder.Build();

app.UseCors();

app.MapGet("/", () => $"It is {DateTime.Now.ToString("d MMM yyyy, HH:mm:ss")}");

app.Run();
